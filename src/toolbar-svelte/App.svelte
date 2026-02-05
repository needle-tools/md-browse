<script lang="ts">
  import { onMount } from "svelte";
  import { appStore } from "$lib/store.svelte";
  import {
    navigateToUrl,
    reloadCurrentPage,
    goBack,
    goForward,
    loadTabs,
    loadSettings,
    updateSettings,
    createNewTab,
    switchTab,
    closeTab,
    notifyWebviewNavigation,
    fetchForViewModeSwitch,
    setupEventListeners,
  } from "$lib/rpc";
  import { generateMarkdownHtml } from "$lib/markdown";
  import monaFontUrl from "./assets/MonaspaceXenonVar.ttf?url";
  import "./styles/theme.css";
  import { START_PAGE_URL, START_PAGE_HTML } from "../shared/start-page";
  import type { ViewMode, BrowserSettings } from "$lib/types";

  const isShim = typeof window !== "undefined" && !(window as unknown as { __electrobunWebviewId?: number }).__electrobunWebviewId;

  // Reference to the webview element
  let contentWebview: HTMLElement & {
    loadURL: (url: string) => void;
    reload: () => void;
    html: string;
    syncDimensions: () => void;
    canGoBack: () => Promise<boolean>;
    canGoForward: () => Promise<boolean>;
    goBack: () => void;
    goForward: () => void;
  };

  let urlInput: HTMLInputElement;
  let contentFrame: HTMLIFrameElement;

  const loadingPageHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{background:#1a1a2e;color:#eaeaea;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui}p{opacity:0.5;font-size:18px}</style></head><body><p>Loading…</p></body></html>`;
  const isStartPageUrl = (url?: string) => url === START_PAGE_URL;

  // Load HTML content into the content view (webview or iframe)
  function loadHtmlIntoContentView(html: string) {
    if (isShim) {
      if (contentFrame) contentFrame.srcdoc = html;
      return;
    }
    const wv = contentWebview as unknown as { loadHTML?: (h: string) => void; webviewId?: number } | undefined;
    if (wv?.loadHTML && wv.webviewId) {
      wv.loadHTML(html);
    } else if (wv) {
      const check = () => {
        if (wv.webviewId) {
          wv.loadHTML!(html);
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    }
  }

  // Load a URL into the content view (webview or iframe)
  function loadUrlIntoContentView(url: string) {
    if (isShim) {
      if (contentFrame) {
        contentFrame.removeAttribute("srcdoc");
        contentFrame.src = url;
      }
      return;
    }
    if (contentWebview) {
      contentWebview.loadURL(url);
    }
  }

  // Handle URL input
  function handleUrlSubmit() {
    const val = urlInput?.value?.trim() ?? "";
    if (val) {
      navigateToUrl(val);
    } else {
      // Empty URL → show start page
      appStore.showWelcomeScreen();
      if (urlInput) urlInput.value = "";
    }
  }

  // Handle view mode change
  async function handleViewModeChange(mode: ViewMode) {
    const wasHtml = appStore.viewMode === "html";
    appStore.setViewMode(mode);

    if (wasHtml && mode !== "html" && appStore.currentUrl) {
      // Switching from HTML mode - refetch with markdown headers
      await fetchForViewModeSwitch();
    } else {
      // Re-render with current content
      renderContent();
    }
  }

  async function applySettings(next: Partial<BrowserSettings>, forceViewMode?: ViewMode) {
    const result = await updateSettings(next);
    if (forceViewMode) {
      appStore.setViewMode(forceViewMode);
    }
    if (result?.needsRefresh && appStore.currentUrl) {
      await fetchForViewModeSwitch();
    }
  }

  // Track the last URL loaded to avoid redundant loads
  let lastContentUrl = "";

  // Render content into the content view (webview or iframe)
  function renderContent() {
    const mode = appStore.viewMode;
    const content = appStore.currentContent;
    const url = appStore.currentUrl;

    console.log("[Render] Mode:", mode, "URL:", url, "Has content:", !!content, "Welcome:", appStore.showWelcome);

    if (mode === "html") {
      if (appStore.showWelcome || !url || isStartPageUrl(url)) {
        lastContentUrl = START_PAGE_URL;
        loadHtmlIntoContentView(START_PAGE_HTML);
        return;
      }

      // HTML mode: load URL directly into the content view
      if (url !== lastContentUrl) {
        lastContentUrl = url;
        loadUrlIntoContentView(url);
      }
      return;
    }

    // Markdown/preview mode: render HTML and load into content view
    lastContentUrl = "";

    if (content) {
      const html = generateMarkdownHtml(content.markdown, mode === "markdown", content.url, true);
      loadHtmlIntoContentView(html);
    } else if (appStore.showWelcome || isStartPageUrl(url)) {
      if (!appStore.isLoading) {
        loadHtmlIntoContentView(loadingPageHtml);
        navigateToUrl(START_PAGE_URL);
      } else {
        loadHtmlIntoContentView(loadingPageHtml);
      }
    } else {
      loadHtmlIntoContentView(loadingPageHtml);
    }
  }

  async function updateWebviewNavigationState() {
    if (isShim || !contentWebview || appStore.viewMode !== "html") return;
    try {
      const [canGoBack, canGoForward] = await Promise.all([
        contentWebview.canGoBack(),
        contentWebview.canGoForward(),
      ]);
      appStore.setNavigation(canGoBack, canGoForward);
    } catch (error) {
      console.warn("[Webview] Failed to read navigation state", error);
    }
  }

  // Handle reload
  function handleReload() {
    if (appStore.viewMode === "html" && contentWebview) {
      contentWebview.reload();
    } else {
      reloadCurrentPage();
    }
  }

  // Handle webview/iframe navigation events
  function handleWebviewNavigation(url: string) {
    if (!url || url === "about:blank") return;

    // Check for intercepted link clicks from injected script (hash-based)
    if (url.includes("#nav:")) {
      const encoded = url.split("#nav:")[1];
      try {
        const targetUrl = decodeURIComponent(encoded);
        console.log("[Webview] Intercepted link click:", targetUrl);
        loadHtmlIntoContentView(loadingPageHtml);
        navigateToUrl(targetUrl);
      } catch (e) {
        console.error("[Webview] Failed to decode nav URL:", e);
      }
      return;
    }

    console.log("[Webview] Navigated to:", url);

    if (appStore.viewMode === "html") {
      // In HTML mode, track the navigation
      appStore.setUrl(url);
      if (urlInput) {
        urlInput.value = url;
      }
      notifyWebviewNavigation(url);
      updateWebviewNavigationState();
    } else {
      // In markdown/preview mode, a real navigation happened
      // (e.g. script interception failed). Show loading and re-fetch.
      loadHtmlIntoContentView(loadingPageHtml);
      navigateToUrl(url);
    }
  }

  // Handle postMessage from iframe (shim mode link interception)
  function handleIframeMessage(event: MessageEvent) {
    if (event.data?.type === "mdbrowse:navigate" && event.data.url) {
      console.log("[Shim] Intercepted link click:", event.data.url);
      navigateToUrl(event.data.url);
    }
  }

  // Watch for content changes and re-render
  $effect(() => {
    const _content = appStore.currentContent;
    const _mode = appStore.viewMode;
    const _welcome = appStore.showWelcome;

    renderContent();
  });

  // Watch for URL changes and update input
  $effect(() => {
    const url = appStore.currentUrl;
    if (urlInput) {
      if (appStore.showWelcome || isStartPageUrl(url)) {
        urlInput.value = "";
      } else {
        urlInput.value = url;
      }
    }
  });

  onMount(() => {
    console.log("[App] Mounting...");

    // Setup RPC event listeners
    setupEventListeners();

    // Listen for postMessage from iframe (shim mode link clicks)
    if (isShim) {
      window.addEventListener("message", handleIframeMessage);
    }

    // Setup webview event listeners
    if (!isShim && contentWebview) {
      contentWebview.addEventListener("did-start-loading", () => {
        appStore.setLoading(true);
      });

      contentWebview.addEventListener("did-stop-loading", () => {
        appStore.setLoading(false);
        updateWebviewNavigationState();
      });

      contentWebview.addEventListener("did-navigate", (e: Event) => {
        const url = (e as CustomEvent).detail;
        if (typeof url === "string") {
          handleWebviewNavigation(url);
        }
      });

      contentWebview.addEventListener("did-navigate-in-page", (e: Event) => {
        const url = (e as CustomEvent).detail;
        if (typeof url === "string") {
          handleWebviewNavigation(url);
        }
      });

      contentWebview.addEventListener("dom-ready", () => {
        console.log("[Webview] DOM ready");
        appStore.setLoading(false);
        updateWebviewNavigationState();
      });
    }

    // Load initial tabs
    loadTabs();
    loadSettings();

    // Focus URL input
    urlInput?.focus();

    console.log("[App] Mounted");
  });

  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
      e.preventDefault();
      urlInput?.focus();
      urlInput?.select();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "r") {
      e.preventDefault();
      handleReload();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "t") {
      e.preventDefault();
      createNewTab();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      appStore.toggleSearch();
    }
    if (e.key === "Escape" && appStore.searchVisible) {
      appStore.closeSearch();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<svelte:head>
  <style>{`
    @font-face {
      font-family: "Monaspace Xenon Var";
      src: url("${monaFontUrl}") format("truetype");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
  `}</style>
</svelte:head>

<div class="app-container">
  <!-- Tab Bar -->
  <div class="tab-bar">
    {#each appStore.tabs as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.isActive}
        onclick={() => switchTab(tab.id)}
        role="button"
        tabindex="0"
      >
        {#if tab.isLoading}
          <div class="tab-loading"></div>
        {/if}
        <span class="tab-title">{tab.title || "New Tab"}</span>
        <span
          class="tab-close"
          onclick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
          role="button"
          tabindex="0"
        >×</span>
      </div>
    {/each}
    <button class="new-tab-btn" onclick={createNewTab} title="New Tab">+</button>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="nav-buttons">
      <button
        class="nav-btn"
        disabled={!appStore.canGoBack}
        onclick={() => {
          if (appStore.viewMode === "html" && contentWebview) {
            contentWebview.goBack();
          } else {
            goBack();
          }
        }}
        title="Go Back"
      >←</button>
      <button
        class="nav-btn"
        disabled={!appStore.canGoForward}
        onclick={() => {
          if (appStore.viewMode === "html" && contentWebview) {
            contentWebview.goForward();
          } else {
            goForward();
          }
        }}
        title="Go Forward"
      >→</button>
      <button
        class="nav-btn"
        onclick={handleReload}
        title="Reload"
      >↻</button>
    </div>

    <div class="url-container">
      <input
        bind:this={urlInput}
        type="text"
        class="url-input"
        placeholder="Enter URL or search..."
        autocomplete="off"
        spellcheck="false"
        onkeydown={(e) => e.key === "Enter" && handleUrlSubmit()}
      />
      {#if appStore.currentContent}
        <span
          class="md-indicator"
          class:visible={true}
          class:converted={!appStore.isMarkdownContent}
          title={appStore.isMarkdownContent ? "Native markdown" : "Converted from HTML"}
        >
          {appStore.isMarkdownContent ? "MD" : "HTML→MD"}
        </span>
      {/if}
    </div>

    <div class="view-toggle">
      {#if !appStore.isMarkdownContent}
        <button
          class="view-toggle-btn"
          class:active={appStore.viewMode === "html"}
          onclick={() => handleViewModeChange("html")}
        >HTML</button>
      {/if}
      <button
        class="view-toggle-btn"
        class:active={appStore.viewMode === "markdown"}
        onclick={() => handleViewModeChange("markdown")}
      >Markdown</button>
      <button
        class="view-toggle-btn"
        class:active={appStore.viewMode === "preview"}
        onclick={() => handleViewModeChange("preview")}
      >Preview</button>
    </div>

    <div class="settings-toggles">
      <div
        class="setting-toggle"
        class:active={appStore.settings.sendAcceptMd}
        onclick={() => applySettings({ sendAcceptMd: !appStore.settings.sendAcceptMd })}
        title="Send Accept: text/markdown header"
      >
        <span class="toggle-label">MD Header</span>
        <div class="toggle-switch"></div>
      </div>
      <div
        class="setting-toggle"
        class:active={appStore.settings.autoConvert}
        onclick={() => {
          const next = !appStore.settings.autoConvert;
          applySettings(
            { autoConvert: next },
            next ? "preview" : "markdown"
          );
        }}
        title="Auto-convert HTML to Markdown"
      >
        <span class="toggle-label">Auto-Convert</span>
        <div class="toggle-switch"></div>
      </div>
    </div>
  </div>

  <!-- Search Modal -->
  {#if appStore.searchVisible}
    <div class="search-modal visible">
      <input
        type="text"
        placeholder="Search in page..."
        value={appStore.searchQuery}
        oninput={(e) => appStore.setSearchQuery(e.currentTarget.value)}
      />
      <span class="search-count">0/0</span>
      <div class="search-nav">
        <button class="search-btn" title="Previous">↑</button>
        <button class="search-btn" title="Next">↓</button>
      </div>
      <button class="search-close" onclick={appStore.closeSearch} title="Close">×</button>
    </div>
  {/if}

  <!-- Content Area -->
  <div class="content-area">
    <!-- Content view: always visible, content loaded via loadHTML/loadURL -->
    {#if isShim}
      <iframe
        bind:this={contentFrame}
        class="content-iframe"
        title="Content"
      ></iframe>
    {:else}
      <electrobun-webview
        bind:this={contentWebview}
        id="contentWebview"
        src="about:blank"
        partition="persist:mdbrowse-content"
      ></electrobun-webview>
    {/if}
  </div>
</div>

<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :root {
    --ui-font: "Monaspace Xenon Var", -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    --bg-primary: #000000;
    --bg-secondary: #000000;
    --bg-toolbar: #000000;
    --bg-input: #000000;
    --text-primary: #eaeaea;
    --text-secondary: #a0a0a0;
    --text-muted: #666680;
    --accent: #484848;
    --accent-text: #9fbc74;
    --accent-hover: #ffffff;
    --border: #888888;
    --border-radius: 0x;
    --border-radius-half: 0;
    --tab-active: #000000;
    --tab-hover: #1e1e35;
    --success: #4ade80;
    --warning: #fbbf24;
  }

  :global(html), :global(body) {
    height: 100%;
    font-family: var(--ui-font);
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
    margin: 0;
    padding: 0;
  }

  :global(input),
  :global(textarea),
  :global(select),
  :global(button) {    
    font-family: var(--ui-font);
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  /* Tab Bar */
  .tab-bar {
    display: flex;
    align-items: center;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    padding: 4px 4px 0px 4px;
    gap: 2px;
    -webkit-app-region: drag;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;

    background: transparent;
    border: none;
    border-radius: var(--border-radius);
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    max-width: 180px;
    min-width: 100px;
    -webkit-app-region: no-drag;
    transition: all 0.15s ease;
  }

  .tab:hover {
    background: var(--tab-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--tab-active);
    border: 1px solid var(--border);
    border-bottom: 0;
    color: var(--text-primary);
  }

  .tab-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .tab-close {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--border-radius);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text-primary);
  }

  .tab-loading {
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .new-tab-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    transition: all 0.15s ease;
  }

  .new-tab-btn:hover {
    background: var(--tab-hover);
    color: var(--text-primary);
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .nav-buttons {
    display: flex;
    gap: 4px;
  }

  .nav-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .url-container {
    flex: 1;
    display: flex;
    align-items: center;
    background: var(--bg-input);
    border-radius: var(--border-radius);
    border: 1px solid var(--border);
    padding: 0 12px;
    height: 36px;
    transition: border-color 0.15s ease;
  }

  .url-container:focus-within {
    border-color: var(--accent);
  }

  .url-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 10px;
    outline: none;
  }

  .url-input::placeholder {
    color: var(--text-secondary);
  }

  .md-indicator {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: var(--border-radius-half);
    background: var(--accent);
    color: white;
    font-weight: 600;
    margin-left: 8px;
    display: none;
    white-space: nowrap;
  }

  .md-indicator.visible {
    display: block;
  }

  .md-indicator.converted {
    background: var(--accent-text);
    color: #1a1a2e;
  }

  /* View Mode Toggle */
  .view-toggle {
    display: flex;
    background: var(--bg-input);
    border-radius: var(--border-radius);
    padding: 3px;
    border: 1px solid var(--border);
  }

  .view-toggle-btn {
    padding: 6px 14px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--border-radius);
    transition: all 0.2s ease;
  }

  .view-toggle-btn.active {
    background: var(--accent);
    color: white;
  }

  .view-toggle-btn:hover:not(.active) {
    color: var(--text-primary);
  }

  /* Settings toggles */
  .settings-toggles {
    display: flex;
    gap: 8px;
    margin-left: 8px;
    padding-left: 8px;
    border-left: 1px solid var(--border);
  }

  .setting-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .setting-toggle:hover {
    background: var(--tab-hover);
  }

  .setting-toggle .toggle-label {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .setting-toggle .toggle-switch {
    width: 32px;
    height: 18px;
    background: var(--text-muted);
    border-radius: var(--border-radius);
    position: relative;
    transition: background 0.2s ease;
  }

  .setting-toggle .toggle-switch::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 0;
    top: 2px;
    left: 2px;
    transition: transform 0.2s ease;
  }

  .setting-toggle.active .toggle-switch {
    background: var(--accent);
  }

  .setting-toggle.active .toggle-switch::after {
    transform: translateX(14px);
  }

  /* Search Modal */
  .search-modal {
    position: fixed;
    top: 80px;
    right: 20px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    padding: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .search-modal input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    padding: 8px 12px;
    color: var(--text-primary);
    font-size: 14px;
    width: 250px;
    outline: none;
  }

  .search-modal input:focus {
    border-color: var(--accent);
  }

  .search-modal .search-nav {
    display: flex;
    gap: 4px;
  }

  .search-modal .search-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: var(--bg-input);
    color: var(--text-secondary);
    border-radius: var(--border-radius-half);
    cursor: pointer;
    font-size: 10px;
  }

  .search-modal .search-btn:hover {
    background: var(--tab-hover);
    color: var(--text-primary);
  }

  .search-modal .search-count {
    font-size: 10px;
    color: var(--text-secondary);
    min-width: 60px;
    text-align: center;
  }

  .search-modal .search-close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 22px;
    border-radius: var(--border-radius-half);
  }

  .search-modal .search-close:hover {
    background: var(--tab-hover);
    color: var(--text-primary);
  }

  /* Content Area */
  .content-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .content-iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: var(--bg-primary);
  }

  electrobun-webview {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
  }

  /* Loading overlay removed */
</style>
