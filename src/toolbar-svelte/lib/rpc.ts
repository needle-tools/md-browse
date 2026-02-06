// RPC utilities for communicating with the bun process
import { appStore } from "./store.svelte";
import type { PageContent, TabInfo, NavigationState, BrowserSettings } from "./types";
import { createRPC, Electroview } from "electrobun/view";
import TurndownService from "turndown";
// @ts-expect-error - turndown-plugin-gfm has no types in this project
import { gfm } from "turndown-plugin-gfm";
import type { ToolbarRPCType } from "../../shared/types";
import { START_PAGE_URL, START_PAGE_TITLE, START_PAGE_MARKDOWN, START_PAGE_HTML } from "../../shared/start-page";

const isShim = typeof window !== "undefined" && !(window as unknown as { __electrobunWebviewId?: number }).__electrobunWebviewId;

function getCharset(contentType: string): string {
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim().replace(/"/g, "").toLowerCase() : "utf-8";
}

function decodeArrayBuffer(buffer: ArrayBuffer, contentType: string): string {
  const charset = getCharset(contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

const shimSettings: BrowserSettings = {
  sendAcceptMd: true,
  autoConvert: true,
  allowJavascript: false,
};

type ShimTab = TabInfo & {
  history: string[];
  historyIndex: number;
  content: PageContent | null;
};

const shimState = {
  tabs: [] as ShimTab[],
  activeTabId: 1,
  nextTabId: 1,
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  bulletListMarker: "-",
});

turndown.use(gfm);

turndown.addRule("ignoreLayoutTables", {
  filter: (node: HTMLElement) => {
    if (node.nodeName !== "TABLE") return false;
    const hasHeaders = node.querySelectorAll("th").length > 0;
    const hasNested = !!node.querySelector("table");
    return !hasHeaders && hasNested;
  },
  replacement: (content: string) => `\n\n${content}\n\n`,
});

const rulesArray = turndown.rules?.array;
if (Array.isArray(rulesArray)) {
  const index = rulesArray.findIndex((r: any) => r?.key === "ignoreLayoutTables");
  if (index > -1) {
    const [rule] = rulesArray.splice(index, 1);
    rulesArray.unshift(rule);
  }
}

turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "nav", "footer", "aside", "meta", "link"]);

// Remove links that have no visible text content (e.g. upvote arrows, empty anchors)
turndown.addRule('removeBlankLinks', {
  filter: function(node: HTMLElement) {
    return node.nodeName === 'A' &&
           node.getAttribute('href') !== null &&
           (node.textContent || '').trim() === '';
  },
  replacement: function() {
    return '';
  }
});

// Post-process Turndown output to fix broken link formatting
function cleanupTurndownOutput(markdown: string): string {
  // Fix multi-line link text: [\n text \n](url) → [text](url)
  markdown = markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match: string, text: string, url: string) => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    return `[${cleaned}](${url})`;
  });
  // Remove orphaned list numbers on their own line (e.g. "21.")
  markdown = markdown.replace(/^\d+\.\s*$/gm, '');
  // Clean up excessive blank lines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  return markdown.trim();
}

function createShimTab(): ShimTab {
  const id = shimState.nextTabId++;
  return {
    id,
    url: "",
    title: "New Tab",
    isActive: false,
    isLoading: false,
    history: [],
    historyIndex: -1,
    content: null,
  };
}

function ensureShimTab(): ShimTab {
  if (shimState.tabs.length === 0) {
    const tab = createShimTab();
    shimState.tabs.push(tab);
    shimState.activeTabId = tab.id;
  }
  let active = shimState.tabs.find((t) => t.id === shimState.activeTabId);
  if (!active) {
    active = shimState.tabs[0];
    shimState.activeTabId = active.id;
  }
  return active;
}

function shimSyncTabs() {
  const activeId = ensureShimTab().id;
  const tabs = shimState.tabs.map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    isActive: t.id === activeId,
    isLoading: t.isLoading,
  }));
  appStore.setTabs(tabs);
}

function shimSyncNavigation() {
  const tab = ensureShimTab();
  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;
  appStore.setNavigation(canGoBack, canGoForward);
}

async function shimFetchPage(url: string): Promise<PageContent> {
  if (url === START_PAGE_URL) {
    if (shimSettings.sendAcceptMd) {
      return {
        url: START_PAGE_URL,
        markdown: START_PAGE_MARKDOWN,
        rawHtml: "",
        title: START_PAGE_TITLE,
        wasMarkdown: true,
      };
    }

    const rawHtml = START_PAGE_HTML;
    const markdown = shimSettings.autoConvert
      ? cleanupTurndownOutput(turndown.turndown(rawHtml))
      : rawHtml;

    return {
      url: START_PAGE_URL,
      markdown,
      rawHtml,
      title: START_PAGE_TITLE,
      wasMarkdown: false,
    };
  }

  const acceptHeader = shimSettings.sendAcceptMd
    ? "text/markdown, text/x-markdown, text/plain, text/html, */*"
    : "text/html, */*";

  const response = await fetch(`/_proxy?url=${encodeURIComponent(url)}`, {
    headers: {
      "Accept": acceptHeader,
      "User-Agent": "MDBrowse/1.0 (Markdown Browser)",
    },
    redirect: "follow",
  });

  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.headers.get("x-final-url") || url;
  const buffer = await response.arrayBuffer();
  const text = decodeArrayBuffer(buffer, contentType);

  let title = "";
  let wasMarkdown = false;
  let markdown = "";
  let rawHtml = "";

  if (
    contentType.includes("text/markdown") ||
    contentType.includes("text/x-markdown") ||
    (contentType.includes("text/plain") && !text.trim().startsWith("<!") && !text.trim().startsWith("<html"))
  ) {
    wasMarkdown = true;
    markdown = text;
    rawHtml = "";
    const headingMatch = markdown.match(/^#\s+(.+)$/m);
    title = headingMatch ? headingMatch[1] : new URL(finalUrl).hostname;
  } else {
    wasMarkdown = false;
    rawHtml = text;
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch ? titleMatch[1].trim() : new URL(finalUrl).hostname;

    if (shimSettings.autoConvert) {
      let cleanHtml = text
        .replace(/<head[\s\S]*?<\/head>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<aside[\s\S]*?<\/aside>/gi, "")
        .replace(/<form[\s\S]*?<\/form>/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<a[^>]*>\s*<\/a>/gi, "");

      const mainMatch = cleanHtml.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i) ||
        cleanHtml.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
      if (mainMatch) {
        cleanHtml = mainMatch[1];
      } else {
        const bodyMatch = cleanHtml.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
          cleanHtml = bodyMatch[1];
        }
      }

      markdown = cleanupTurndownOutput(turndown.turndown(cleanHtml));
    } else {
      markdown = rawHtml;
    }
  }

  return {
    url: finalUrl,
    markdown,
    rawHtml,
    title,
    wasMarkdown,
  };
}

async function shimNavigate(url: string, updateHistory = true): Promise<void> {
  const tab = ensureShimTab();
  tab.isLoading = true;
  appStore.setLoading(true);
  appStore.setUrl(url);
  shimSyncTabs();
  shimSyncNavigation();

  const content = await shimFetchPage(url);
  tab.url = content.url;
  tab.title = content.title || tab.title;
  tab.isLoading = false;
  tab.content = content;

  if (updateHistory) {
    const lastUrl = tab.history[tab.history.length - 1];
    if (lastUrl !== content.url) {
      if (tab.historyIndex < tab.history.length - 1) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
      }
      tab.history.push(content.url);
      tab.historyIndex = tab.history.length - 1;
    }
  }

  appStore.setContent(content);
  appStore.setLoading(false);
  shimSyncTabs();
  shimSyncNavigation();
}

type BunSchema = ToolbarRPCType["bun"];
type WebviewSchema = ToolbarRPCType["webview"];

type MixedWebviewSchema = {
  requests: BunSchema["requests"];
  messages: WebviewSchema["messages"];
};

type MixedBunSchema = {
  requests: WebviewSchema["requests"];
  messages: BunSchema["messages"];
};

type WebviewRPC = ReturnType<typeof createRPC<MixedWebviewSchema, MixedBunSchema>>;

// Lazy-loaded electroview instance
let electroview: Electroview<WebviewRPC> | null = null;

function initElectroview() {
  if (typeof window === "undefined") {
    throw new Error("Electroview not available");
  }

  const rpc = createRPC<MixedWebviewSchema, MixedBunSchema>({
    maxRequestTime: 30000,
    requestHandler: {},
    transport: {
      registerHandler: () => {},
    },
  });

  return new Electroview({ rpc });
}

function getElectroview() {
  if (!electroview) {
    electroview = initElectroview();
  }
  return electroview;
}

// RPC Actions
export async function navigateToUrl(url: string): Promise<void> {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return;

  console.log("[RPC] Navigate to:", normalizedUrl);

  if (isShim) {
    await shimNavigate(normalizedUrl, true);
    return;
  }

  appStore.setUrl(normalizedUrl);
  appStore.setLoading(true);

  try {
    await getElectroview().rpc.request.navigate({ url: normalizedUrl });
    // Content will be received via mdbrowse:content event
  } catch (error) {
    console.error("[RPC] Navigation error:", error);
    appStore.setLoading(false);
  }
}

export async function reloadCurrentPage(): Promise<void> {
  const currentUrl = appStore.currentUrl;

  if (!currentUrl) {
    console.log("[RPC] Reload: No current URL");
    return;
  }

  console.log("[RPC] Reload:", currentUrl);
  appStore.setLoading(true);

  if (isShim) {
    await shimNavigate(currentUrl, false);
    return;
  }

  if (appStore.viewMode === "html") {
    // In HTML mode, reload will be handled by the webview component
    appStore.setLoading(false);
    return;
  }

  // Re-fetch through bun
  try {
    await getElectroview().rpc.request.navigate({ url: currentUrl });
  } catch (error) {
    console.error("[RPC] Reload error:", error);
    appStore.setLoading(false);
  }
}

export async function goBack(): Promise<void> {
  console.log("[RPC] Go back");
  if (isShim) {
    const tab = ensureShimTab();
    if (tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    const url = tab.history[tab.historyIndex];
    await shimNavigate(url, false);
    return;
  }
  try {
    const result = await getElectroview().rpc.request.goBack({}) as { success: boolean };
    // Navigation state will be updated via events
  } catch (error) {
    console.error("[RPC] Go back error:", error);
  }
}

export async function goForward(): Promise<void> {
  console.log("[RPC] Go forward");
  if (isShim) {
    const tab = ensureShimTab();
    if (tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex += 1;
    const url = tab.history[tab.historyIndex];
    await shimNavigate(url, false);
    return;
  }
  try {
    const result = await getElectroview().rpc.request.goForward({}) as { success: boolean };
    // Navigation state will be updated via events
  } catch (error) {
    console.error("[RPC] Go forward error:", error);
  }
}

export async function loadTabs(): Promise<void> {
  if (isShim) {
    shimSyncTabs();
    return;
  }
  try {
    const result = await getElectroview().rpc.request.getTabs({}) as { tabs: TabInfo[] };
    if (result?.tabs) {
      appStore.setTabs(result.tabs);
    }
  } catch (error) {
    console.error("[RPC] Load tabs error:", error);
  }
}

export async function loadSettings(): Promise<void> {
  if (isShim) {
    appStore.updateSettings(shimSettings);
    return;
  }
  try {
    const result = await getElectroview().rpc.request.getSettings({}) as BrowserSettings;
    if (result) {
      appStore.updateSettings(result);
    }
  } catch (error) {
    console.error("[RPC] Load settings error:", error);
  }
}

export async function updateSettings(newSettings: Partial<BrowserSettings>): Promise<{ success: boolean; needsRefresh: boolean } | null> {
  appStore.updateSettings(newSettings);
  if (isShim) {
    const oldSettings = { ...shimSettings };
    Object.assign(shimSettings, newSettings);
    const needsRefresh =
      oldSettings.sendAcceptMd !== shimSettings.sendAcceptMd ||
      oldSettings.autoConvert !== shimSettings.autoConvert ||
      oldSettings.allowJavascript !== shimSettings.allowJavascript;
    return { success: true, needsRefresh };
  }
  try {
    const result = await getElectroview().rpc.request.updateSettings(newSettings) as { success: boolean; needsRefresh: boolean };
    return result ?? { success: true, needsRefresh: false };
  } catch (error) {
    console.error("[RPC] Update settings error:", error);
    return null;
  }
}

export async function createNewTab(): Promise<void> {
  console.log("[RPC] Create new tab");
  if (isShim) {
    const tab = createShimTab();
    shimState.tabs.push(tab);
    shimState.activeTabId = tab.id;
    appStore.showWelcomeScreen();
    shimSyncTabs();
    shimSyncNavigation();
    return;
  }
  try {
    await getElectroview().rpc.request.createTab({});
    await loadTabs();
    appStore.showWelcomeScreen();
  } catch (error) {
    console.error("[RPC] Create tab error:", error);
  }
}

export async function switchTab(tabId: number): Promise<void> {
  console.log("[RPC] Switch tab:", tabId);
  if (isShim) {
    const tab = shimState.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    shimState.activeTabId = tabId;
    if (tab.content) {
      appStore.setContent(tab.content);
    } else if (tab.url) {
      appStore.setUrl(tab.url);
      appStore.clearContentForLoading();
    } else {
      appStore.showWelcomeScreen();
    }
    shimSyncTabs();
    shimSyncNavigation();
    return;
  }
  try {
    await getElectroview().rpc.request.switchTab({ tabId });
    await loadTabs();
  } catch (error) {
    console.error("[RPC] Switch tab error:", error);
  }
}

export async function closeTab(tabId: number): Promise<void> {
  console.log("[RPC] Close tab:", tabId);
  if (isShim) {
    const index = shimState.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    const wasActive = shimState.activeTabId === tabId;
    shimState.tabs.splice(index, 1);

    if (shimState.tabs.length === 0) {
      const tab = createShimTab();
      shimState.tabs.push(tab);
      shimState.activeTabId = tab.id;
      appStore.showWelcomeScreen();
    } else if (wasActive) {
      const newIndex = Math.min(index, shimState.tabs.length - 1);
      const next = shimState.tabs[newIndex];
      shimState.activeTabId = next.id;
      if (next.content) {
        appStore.setContent(next.content);
      } else if (next.url) {
        appStore.setUrl(next.url);
        appStore.clearContentForLoading();
      } else {
        appStore.showWelcomeScreen();
      }
    }

    shimSyncTabs();
    shimSyncNavigation();
    return;
  }
  try {
    await getElectroview().rpc.request.closeTab({ tabId });
    await loadTabs();
  } catch (error) {
    console.error("[RPC] Close tab error:", error);
  }
}

export async function notifyWebviewNavigation(url: string): Promise<void> {
  if (!url || url === "about:blank") return;
  
  console.log("[RPC] Webview navigated:", url);
  
  // Update store
  appStore.setUrl(url);

  if (isShim) {
    return;
  }

  // Notify bun process
  try {
    await getElectroview().rpc.request.onWebviewNavigated({ url });
  } catch (error) {
    console.error("[RPC] Notify navigation error:", error);
  }
}

export async function fetchForViewModeSwitch(): Promise<void> {
  const currentUrl = appStore.currentUrl;
  if (!currentUrl) return;
  
  console.log("[RPC] Fetching for view mode switch:", currentUrl);
  appStore.setLoading(true);

  if (isShim) {
    await shimNavigate(currentUrl, false);
    return;
  }

  try {
    await getElectroview().rpc.request.refetchForViewMode({});
  } catch (error) {
    console.error("[RPC] View mode fetch error:", error);
    appStore.setLoading(false);
  }
}

// URL normalization
export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";

  if (url.startsWith("mdbrowse://")) {
    return url;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.includes(".") && !url.includes(" ")) {
    return "https://" + url;
  }

  return "https://" + url;
}

// Setup event listeners for content from bun process
export function setupEventListeners(): void {
  if (isShim) {
    console.log("[Event] Event listeners set up (shim)");
    return;
  }
  // Content received from bun
  window.addEventListener("mdbrowse:content", ((e: CustomEvent<PageContent>) => {
    console.log("[Event] Content received:", e.detail.url);
    handleContentReceived(e.detail);
  }) as EventListener);

  // Navigation state updates
  window.addEventListener("mdbrowse:navState", ((e: CustomEvent<NavigationState>) => {
    appStore.setNavigation(e.detail.canGoBack, e.detail.canGoForward);
    appStore.setLoading(e.detail.isLoading);
    if (e.detail.url) {
      appStore.setUrl(e.detail.url);
    }
  }) as EventListener);

  // Tabs update
  window.addEventListener("mdbrowse:tabs", ((e: CustomEvent<{ tabs: TabInfo[] }>) => {
    appStore.setTabs(e.detail.tabs);
  }) as EventListener);

  // Loading started
  window.addEventListener("mdbrowse:loadingStarted", ((e: CustomEvent<{ url: string }>) => {
    appStore.setLoading(true);
    appStore.setUrl(e.detail.url);
  }) as EventListener);

  // Loading finished
  window.addEventListener("mdbrowse:loadingFinished", ((e: CustomEvent<{ url: string; title: string }>) => {
    appStore.setLoading(false);
  }) as EventListener);

  // Settings updated
  window.addEventListener("mdbrowse:settings", ((e: CustomEvent<BrowserSettings>) => {
    appStore.updateSettings(e.detail);
  }) as EventListener);

  // Clear content
  window.addEventListener("mdbrowse:clearContent", (() => {
    const currentUrl = appStore.currentUrl;
    if (appStore.isLoading || (currentUrl && currentUrl !== START_PAGE_URL)) {
      appStore.clearContentForLoading();
      return;
    }
    appStore.showWelcomeScreen();
  }) as EventListener);

  console.log("[Event] Event listeners set up");
}

// Handle received content
function handleContentReceived(content: PageContent): void {
  appStore.setContent(content);
  appStore.setLoading(false);

  // Auto-switch to preview for native markdown content
  if (content.wasMarkdown && appStore.viewMode === "html") {
    appStore.setViewMode("preview");
  }
}
