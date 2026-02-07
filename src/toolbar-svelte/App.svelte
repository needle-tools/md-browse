<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
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
  import "./styles/theme.css";
  import { START_PAGE_URL, START_PAGE_HTML } from "../shared/start-page";
  import type { ViewMode, BrowserSettings } from "$lib/types";

  const isShim = typeof window !== "undefined" && !(window as unknown as { __electrobunWebviewId?: number }).__electrobunWebviewId;

  // Preload script for the content webview: forwards keyboard shortcuts to the host
  const contentPreload = [
    "document.addEventListener('keydown', function(e) {",
    "if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'l')) {",
    "e.preventDefault();",
    "if (window.__electrobunSendToHost) window.__electrobunSendToHost({ type: 'shortcut', action: e.key === 'f' ? 'search' : 'focus-url' });",
    "}",
    "if (e.key === 'Escape') {",
    "if (window.__electrobunSendToHost) window.__electrobunSendToHost({ type: 'shortcut', action: 'close-search' });",
    "}",
    "});"
  ].join(" ");

  // Reference to the webview element
  let contentWebview = $state<
    (HTMLElement & {
    loadURL: (url: string) => void;
    reload: () => void;
    html: string;
    syncDimensions: () => void;
    canGoBack: () => Promise<boolean>;
    canGoForward: () => Promise<boolean>;
    goBack: () => void;
    goForward: () => void;
    findInPage?: (searchText: string, options?: { forward?: boolean; matchCase?: boolean }) => void;
    stopFindInPage?: () => void;
    callAsyncJavaScript?: (options: { script: string }) => Promise<unknown>;
    on?: (event: string, listener: (e: any) => void) => void;
    }) | null
  >(null);

  let urlInput: HTMLInputElement;
  let searchInput: HTMLInputElement;
  let contentFrame = $state<HTMLIFrameElement | null>(null);
  let searchCount = $state(0);
  let searchIndex = $state(0);

  const viewModeByTab = new Map<number, ViewMode>();
  let lastActiveTabId: number | null = null;

  function getActiveTabId(): number | null {
    return appStore.tabs.find((t) => t.isActive)?.id ?? null;
  }

  const isStartPageUrl = (url?: string) => url === START_PAGE_URL;

  const highlightStyle = "background: rgba(250, 204, 21, 0.35); color: inherit;";
  const activeHighlightStyle = "background: rgba(59, 130, 246, 0.55); color: inherit;";

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function clearIframeHighlights(doc: Document) {
    const marks = Array.from(doc.querySelectorAll("mark.mdbrowse-search-hit"));
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(doc.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    }
  }

  function highlightIframeMatches(doc: Document, query: string) {
    clearIframeHighlights(doc);
    if (!query) return { count: 0, index: 0 };

    const regex = new RegExp(escapeRegExp(query), "gi");
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const text = node.nodeValue || "";
        if (!text.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, mark.mdbrowse-search-hit")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    let count = 0;
    const marks: HTMLElement[] = [];

    for (const node of textNodes) {
      const text = node.nodeValue || "";
      regex.lastIndex = 0;
      if (!regex.test(text)) continue;
      regex.lastIndex = 0;
      const fragment = doc.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > lastIndex) {
          fragment.append(text.slice(lastIndex, start));
        }
        const mark = doc.createElement("mark");
        mark.className = "mdbrowse-search-hit";
        mark.setAttribute("style", highlightStyle);
        mark.textContent = text.slice(start, end);
        fragment.append(mark);
        marks.push(mark);
        count += 1;
        lastIndex = end;
      }
      if (lastIndex < text.length) {
        fragment.append(text.slice(lastIndex));
      }
      node.parentNode?.replaceChild(fragment, node);
    }

    if (marks.length > 0) {
      marks[0].classList.add("mdbrowse-search-active");
      marks[0].setAttribute("style", activeHighlightStyle);
      marks[0].scrollIntoView({ block: "center", behavior: "smooth" });
      return { count: marks.length, index: 1 };
    }
    return { count: 0, index: 0 };
  }

  function activateIframeMatch(doc: Document, nextIndex: number) {
    const marks = Array.from(doc.querySelectorAll("mark.mdbrowse-search-hit")) as HTMLElement[];
    if (marks.length === 0) return { count: 0, index: 0 };
    const normalized = ((nextIndex - 1 + marks.length) % marks.length);
    marks.forEach((mark) => {
      mark.classList.remove("mdbrowse-search-active");
      mark.setAttribute("style", highlightStyle);
    });
    const active = marks[normalized];
    active.classList.add("mdbrowse-search-active");
    active.setAttribute("style", activeHighlightStyle);
    active.scrollIntoView({ block: "center", behavior: "smooth" });
    return { count: marks.length, index: normalized + 1 };
  }

  async function runWebviewSearch(action: "highlight" | "next" | "prev" | "clear", query: string) {
    if (!contentWebview?.callAsyncJavaScript) return { count: 0, index: 0 };
    const script = `(() => {
      const action = ${JSON.stringify(action)};
      const query = ${JSON.stringify(query)};
      const highlightStyle = ${JSON.stringify(highlightStyle)};
      const activeHighlightStyle = ${JSON.stringify(activeHighlightStyle)};
      const escapeRegExp = (value) => value.replace(/[.*+?^{}$()|[\\]\\\\]/g, "\\\\$&");

      const state = window.__mdbrowseSearchState || { query: "", count: 0, index: 0 };
      const clearHighlights = () => {
        const marks = Array.from(document.querySelectorAll("mark.mdbrowse-search-hit"));
        for (const mark of marks) {
          const parent = mark.parentNode;
          if (!parent) continue;
          parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          parent.normalize();
        }
      };

      const highlightMatches = (text) => {
        clearHighlights();
        if (!text) return { count: 0, index: 0 };
        const regex = new RegExp(escapeRegExp(text), "gi");
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const value = node.nodeValue || "";
            if (!value.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest("script, style, mark.mdbrowse-search-hit")) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        let count = 0;
        const marks = [];

        for (const node of nodes) {
          const value = node.nodeValue || "";
          regex.lastIndex = 0;
          if (!regex.test(value)) continue;
          regex.lastIndex = 0;
          const fragment = document.createDocumentFragment();
          let lastIndex = 0;
          let match;
          while ((match = regex.exec(value)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (start > lastIndex) fragment.append(value.slice(lastIndex, start));
            const mark = document.createElement("mark");
            mark.className = "mdbrowse-search-hit";
            mark.setAttribute("style", highlightStyle);
            mark.textContent = value.slice(start, end);
            fragment.append(mark);
            marks.push(mark);
            count += 1;
            lastIndex = end;
          }
          if (lastIndex < value.length) fragment.append(value.slice(lastIndex));
          node.parentNode?.replaceChild(fragment, node);
        }

        if (marks.length > 0) {
          const active = marks[0];
          active.classList.add("mdbrowse-search-active");
          active.setAttribute("style", activeHighlightStyle);
          active.scrollIntoView({ block: "center", behavior: "smooth" });
          return { count: marks.length, index: 1 };
        }
        return { count: 0, index: 0 };
      };

      const activateIndex = (nextIndex) => {
        const marks = Array.from(document.querySelectorAll("mark.mdbrowse-search-hit"));
        if (!marks.length) return { count: 0, index: 0 };
        const normalized = ((nextIndex - 1 + marks.length) % marks.length);
        marks.forEach((mark) => {
          mark.classList.remove("mdbrowse-search-active");
          mark.setAttribute("style", highlightStyle);
        });
        const active = marks[normalized];
        active.classList.add("mdbrowse-search-active");
        active.setAttribute("style", activeHighlightStyle);
        active.scrollIntoView({ block: "center", behavior: "smooth" });
        return { count: marks.length, index: normalized + 1 };
      };

      if (action === "clear" || !query) {
        clearHighlights();
        window.__mdbrowseSearchState = { query: "", count: 0, index: 0 };
        return window.__mdbrowseSearchState;
      }

      if (action === "highlight" || state.query !== query) {
        const result = highlightMatches(query);
        window.__mdbrowseSearchState = { query, count: result.count, index: result.index };
        return window.__mdbrowseSearchState;
      }

      if (action === "next") {
        const result = activateIndex(state.index + 1);
        window.__mdbrowseSearchState = { query, count: result.count, index: result.index };
        return window.__mdbrowseSearchState;
      }

      if (action === "prev") {
        const result = activateIndex(state.index - 1);
        window.__mdbrowseSearchState = { query, count: result.count, index: result.index };
        return window.__mdbrowseSearchState;
      }

      return window.__mdbrowseSearchState || { query: "", count: 0, index: 0 };
    })();`;

    const result = await contentWebview.callAsyncJavaScript({ script });
    if (result && typeof result === "object") {
      const output = result as { count?: number; index?: number };
      return { count: output.count ?? 0, index: output.index ?? 0 };
    }
    return { count: 0, index: 0 };
  }

  async function updateSearchState(count: number, index: number) {
    searchCount = count;
    searchIndex = index;
  }

  async function clearSearch() {
    if (isShim) {
      const doc = contentFrame?.contentDocument;
      if (doc) clearIframeHighlights(doc);
    } else if (contentWebview?.stopFindInPage) {
      contentWebview.stopFindInPage();
    } else if (!isShim) {
      await runWebviewSearch("clear", "");
    }
    updateSearchState(0, 0);
  }

  async function runSearch(action: "highlight" | "next" | "prev" = "highlight") {
    const query = appStore.searchQuery.trim();
    if (!query) {
      await clearSearch();
      return;
    }

    if (isShim) {
      const doc = contentFrame?.contentDocument;
      if (!doc) return;
      if (action === "highlight") {
        const result = highlightIframeMatches(doc, query);
        updateSearchState(result.count, result.index);
      } else {
        const nextIndex = action === "next" ? searchIndex + 1 : searchIndex - 1;
        const result = activateIframeMatch(doc, nextIndex);
        updateSearchState(result.count, result.index);
      }
      return;
    }

    if (contentWebview?.findInPage) {
      contentWebview.findInPage(query, { forward: action !== "prev", matchCase: false });
      updateSearchState(0, 0);
      return;
    }

    const result = await runWebviewSearch(action, query);
    updateSearchState(result.count, result.index);
  }

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
    const activeTabId = getActiveTabId();
    if (activeTabId !== null) {
      viewModeByTab.set(activeTabId, mode);
    }
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

  async function handleTabSwitch(tabId: number) {
    const currentActiveId = getActiveTabId();
    if (currentActiveId !== null) {
      viewModeByTab.set(currentActiveId, appStore.viewMode);
    }

    await switchTab(tabId);

    const desiredMode = viewModeByTab.get(tabId);
    if (desiredMode && desiredMode !== appStore.viewMode) {
      await handleViewModeChange(desiredMode);
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
        navigateToUrl(START_PAGE_URL);
      }
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

  function extractNavigationUrl(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (detail && typeof (detail as { url?: unknown }).url === "string") {
      return (detail as { url: string }).url;
    }
    return "";
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
      navigateToUrl(url);
    }
  }

  let attachedWebview: typeof contentWebview = null;
  function attachWebviewListeners() {
    if (isShim || !contentWebview || contentWebview === attachedWebview) return;
    attachedWebview = contentWebview;

    contentWebview.addEventListener("did-start-loading", () => {
      appStore.setLoading(true);
    });

    contentWebview.addEventListener("did-stop-loading", () => {
      appStore.setLoading(false);
      updateWebviewNavigationState();
    });

    const navHandler = (e: Event) => {
      const url = extractNavigationUrl((e as CustomEvent).detail);
      if (url) handleWebviewNavigation(url);
    };

    contentWebview.addEventListener("did-navigate", navHandler);
    contentWebview.addEventListener("did-navigate-in-page", navHandler);
    contentWebview.addEventListener("did-commit-navigation", navHandler);

    contentWebview.addEventListener("dom-ready", () => {
      console.log("[Webview] DOM ready");
      appStore.setLoading(false);
      updateWebviewNavigationState();
    });

    // Listen for keyboard shortcuts forwarded from the content webview's preload
    contentWebview.on?.("host-message", (event: any) => {
      const msg = event?.detail;
      if (msg?.type === "shortcut") {
        if (msg.action === "search") appStore.toggleSearch();
        else if (msg.action === "focus-url") { urlInput?.focus(); urlInput?.select(); }
        else if (msg.action === "close-search") appStore.closeSearch();
      }
    });
  }

  // Inject keyboard shortcut listeners into iframe (shim mode)
  function injectIframeShortcuts() {
    if (!contentFrame?.contentWindow) return;
    try {
      contentFrame.contentWindow.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'l')) {
          e.preventDefault();
          window.postMessage({ type: 'mdbrowse:shortcut', action: e.key === 'f' ? 'search' : 'focus-url' }, '*');
        }
        if (e.key === 'Escape') {
          window.postMessage({ type: 'mdbrowse:shortcut', action: 'close-search' }, '*');
        }
      });
    } catch {
      // Cross-origin iframe, can't inject shortcuts
    }
  }

  // Handle postMessage from iframe (shim mode link interception)
  function handleIframeMessage(event: MessageEvent) {
    if (event.data?.type === "mdbrowse:navigate" && event.data.url) {
      console.log("[Shim] Intercepted link click:", event.data.url);
      navigateToUrl(event.data.url);
    }
    if (event.data?.type === "mdbrowse:shortcut" && event.data.action) {
      const action = event.data.action;
      if (action === "search") appStore.toggleSearch();
      else if (action === "focus-url") { urlInput?.focus(); urlInput?.select(); }
      else if (action === "close-search") appStore.closeSearch();
    }
  }

  // Watch for content changes and re-render
  $effect(() => {
    const _content = appStore.currentContent;
    const _mode = appStore.viewMode;
    const _welcome = appStore.showWelcome;

    renderContent();
  });

  $effect(() => {
    const activeId = getActiveTabId();
    if (activeId !== lastActiveTabId) {
      lastActiveTabId = activeId;
      const desiredMode = activeId ? viewModeByTab.get(activeId) : undefined;
      if (desiredMode && desiredMode !== appStore.viewMode) {
        handleViewModeChange(desiredMode);
      }
    }
  });

  $effect(() => {
    attachWebviewListeners();
  });

  $effect(() => {
    const visible = appStore.searchVisible;
    untrack(() => {
      if (visible) {
        tick().then(() => {
          searchInput?.focus();
          searchInput?.select();
        });
      } else {
        clearSearch();
      }
    });
  });

  $effect(() => {
    const _content = appStore.currentContent;
    const _mode = appStore.viewMode;
    if (appStore.searchVisible && appStore.searchQuery.trim()) {
      runSearch("highlight");
    }
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

    const handleShortcutEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (!detail?.action) return;
      if (detail.action === "search") {
        appStore.toggleSearch();
      } else if (detail.action === "focus-url") {
        urlInput?.focus();
        urlInput?.select();
      } else if (detail.action === "close-search") {
        appStore.closeSearch();
      }
    };

    window.addEventListener("mdbrowse:shortcut", handleShortcutEvent as EventListener);

    // Setup RPC event listeners
    setupEventListeners();

    // Listen for postMessage from iframe (shim mode link clicks & shortcuts)
    if (isShim) {
      window.addEventListener("message", handleIframeMessage);
      // Re-inject keyboard shortcut handlers on each iframe load
      contentFrame?.addEventListener("load", injectIframeShortcuts);
    }

    attachWebviewListeners();

    // Load initial tabs
    loadTabs();
    loadSettings();

    // Focus URL input
    urlInput?.focus();

    console.log("[App] Mounted");

    return () => {
      window.removeEventListener("mdbrowse:shortcut", handleShortcutEvent as EventListener);
    };
  });

  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const isEditable = !!target && (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );

    // Always allow search shortcuts even when in editable fields
    const isSearchShortcut =
      ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "l")) ||
      (e.key === "Escape" && appStore.searchVisible);

    if (isEditable && !isSearchShortcut) {
      return;
    }

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

<div class="app-container">
  <!-- Tab Bar -->
  <div class="tab-bar electrobun-webkit-app-region-drag">
    {#each appStore.tabs as tab (tab.id)}
      <div
        class="tab electrobun-webkit-app-region-no-drag"
        class:active={tab.isActive}
        onclick={() => handleTabSwitch(tab.id)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleTabSwitch(tab.id);
          }
        }}
        role="button"
        tabindex="0"
      >
        {#if tab.isLoading}
          <div class="tab-loading"></div>
        {/if}
        <span class="tab-title">{tab.title || "New Tab"}</span>
        <button
          type="button"
          class="tab-close electrobun-webkit-app-region-no-drag"
          onclick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
          aria-label="Close tab"
        >×</button>
      </div>
    {/each}
    <button class="new-tab-btn electrobun-webkit-app-region-no-drag" onclick={createNewTab} title="New Tab">+</button>
  </div>

  <!-- Toolbar -->
  <div class="toolbar electrobun-webkit-app-region-drag">
    <div class="nav-buttons electrobun-webkit-app-region-no-drag">
      <button
        class="nav-btn electrobun-webkit-app-region-no-drag"
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
        class="nav-btn electrobun-webkit-app-region-no-drag"
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
        class="nav-btn electrobun-webkit-app-region-no-drag"
        onclick={handleReload}
        title="Reload"
      >↻</button>
    </div>

    <div class="url-container electrobun-webkit-app-region-no-drag">
      <input
        bind:this={urlInput}
        type="text"
        class="url-input electrobun-webkit-app-region-no-drag"
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

    <div class="view-toggle electrobun-webkit-app-region-no-drag">
      {#if !appStore.isMarkdownContent}
        <button
          class="view-toggle-btn electrobun-webkit-app-region-no-drag"
          class:active={appStore.viewMode === "html"}
          onclick={() => handleViewModeChange("html")}
        >HTML</button>
      {/if}
      <button
        class="view-toggle-btn electrobun-webkit-app-region-no-drag"
        class:active={appStore.viewMode === "markdown"}
        onclick={() => handleViewModeChange("markdown")}
      >Markdown</button>
      <button
        class="view-toggle-btn electrobun-webkit-app-region-no-drag"
        class:active={appStore.viewMode === "preview"}
        onclick={() => handleViewModeChange("preview")}
      >Preview</button>
    </div>

    {#if !appStore.searchVisible}
    <div class="settings-toggles electrobun-webkit-app-region-no-drag">
      <button
        type="button"
        class="setting-toggle electrobun-webkit-app-region-no-drag"
        class:active={appStore.settings.sendAcceptMd}
        onclick={() => applySettings({ sendAcceptMd: !appStore.settings.sendAcceptMd })}
        title="Send Accept: text/markdown header"
        aria-pressed={appStore.settings.sendAcceptMd}
      >
        <span class="toggle-label">accept: text/markdown</span>
        <div class="toggle-switch"></div>
      </button>
      <button
        type="button"
        class="setting-toggle electrobun-webkit-app-region-no-drag"
        class:active={appStore.settings.autoConvert}
        onclick={() => {
          const next = !appStore.settings.autoConvert;
          applySettings(
            { autoConvert: next },
            next ? "preview" : "markdown"
          );
        }}
        title="Auto-convert HTML to Markdown"
        aria-pressed={appStore.settings.autoConvert}
      >
        <span class="toggle-label">html-to-md</span>
        <div class="toggle-switch"></div>
      </button>
    </div>
    {/if}

    <!-- Search Modal -->
    {#if appStore.searchVisible}
      <div class="search-modal electrobun-webkit-app-region-no-drag">
        <input
          bind:this={searchInput}
          type="text"
          placeholder="Search in page..."
          value={appStore.searchQuery}
          oninput={(e) => {
            appStore.setSearchQuery(e.currentTarget.value);
            runSearch("highlight");
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch(e.shiftKey ? "prev" : "next");
            }
          }}
        />
        <div class="search-nav">
          <button class="search-btn" title="Previous" onclick={() => runSearch("prev")}>↑</button>
          <button class="search-btn" title="Next" onclick={() => runSearch("next")}>↓</button>
        </div>
        <button class="search-close" onclick={appStore.closeSearch} title="Close">×</button>
      </div>
    {/if}
  </div>

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
        preload={contentPreload}
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
    --ui-font: "iA Writer Duo V", -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    --bg-primary: #000000;
    --bg-secondary: #000000;
    --bg-toolbar: #000000;
    --bg-input: #000000;
    --text-primary: #c5c5c5;
    --text-secondary: #a0a0a0;
    --text-muted: #666680;
    --accent: #7b7b7b;
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
    padding: 4px 4px 0px 104px;
    gap: 2px;
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
    position: relative;
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
    padding: 9px 12px;
  }

  .url-input::placeholder {
    color: var(--text-secondary);
  }

  .md-indicator {
    font-size: 10px;
    padding: 6px 14px;
    border-radius: var(--border-radius-half);
    background: var(--accent-text);
    color: black;
    font-weight: 600;
    font-variation-settings: "wght" 600;
    margin-left: 8px;
    margin-right: 3px;
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
    background: var(--accent-text);
  }

  .setting-toggle.active .toggle-switch::after {
    transform: translateX(14px);
  }

  /* Search Modal */
  .search-modal {
    display: flex;
    gap: 8px;
    align-items: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    padding: 3px 3px;
  }

  .search-modal input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    padding: 4px 4px;
    color: var(--text-primary);
    font-size: 10px;
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
    border: none;
    background: var(--bg-input);
    color: var(--text-secondary);
    border-radius: var(--border-radius-half);
    cursor: pointer;
    font-size: 18px;
  }

  .search-modal .search-btn:hover {
    background: var(--tab-hover);
    color: var(--text-primary);
  }

  .search-modal .search-close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 18px;
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
