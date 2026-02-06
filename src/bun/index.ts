import { BrowserWindow, BrowserView, ApplicationMenu, Utils } from "electrobun/bun";
import type { ToolbarRPCType, TabInfo, NavigationState, PageContent, BrowserSettings } from "../shared/types";
import TurndownService from "turndown";
// @ts-expect-error - turndown-plugin-gfm has no types in this project
import { gfm } from "turndown-plugin-gfm";
import { START_PAGE_URL, START_PAGE_TITLE, START_PAGE_MARKDOWN, START_PAGE_HTML } from "../shared/start-page";

console.log("[MDBrowse] Starting markdown browser...");

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

// Initialize Turndown for HTML to Markdown conversion
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  bulletListMarker: "-",
});

turndown.use(gfm);

turndown.addRule("ignoreLayoutTables", {
  filter: (node: any) => {
    if (node.nodeName !== "TABLE") return false;
    const table = node as Element;
    const hasHeaders = table.querySelectorAll("th").length > 0;
    const hasNested = !!table.querySelector("table");
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

// Remove unwanted elements
turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "nav", "footer", "aside", "meta", "link"]);

// Remove links that have no visible text content (e.g. upvote arrows, empty anchors)
turndown.addRule('removeBlankLinks', {
  filter: function(node: any) {
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
  markdown = markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text, url) => {
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

function getCharset(contentType: string): string {
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim().replace(/"/g, "").toLowerCase() : "utf-8";
}

async function decodeResponseBody(response: Response, contentType: string): Promise<string> {
  const buffer = await response.arrayBuffer();
  const charset = getCharset(contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

// Browser settings
let settings: BrowserSettings = {
  sendAcceptMd: true,
  autoConvert: true,
  allowJavascript: false,
};

// State management
interface Tab {
  id: number;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
  isLoading: boolean;
  content: PageContent | null;
}

let tabs: Tab[] = [];
let activeTabId = 0;
let nextTabId = 1;
let viewMode: "markdown" | "preview" = "markdown";
let mainWindow: BrowserWindow;

// Get the active tab
function getActiveTab(): Tab | undefined {
  return tabs.find(t => t.id === activeTabId);
}

// Get tab info for RPC
function getTabInfos(): TabInfo[] {
  return tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title || t.url || "New Tab",
    isActive: t.id === activeTabId,
    isLoading: t.isLoading,
  }));
}

// Get navigation state
function getNavigationState(): NavigationState {
  const tab = getActiveTab();
  return {
    canGoBack: tab ? tab.historyIndex > 0 : false,
    canGoForward: tab ? tab.historyIndex < tab.history.length - 1 : false,
    isLoading: tab?.isLoading ?? false,
    url: tab?.url ?? "",
    title: tab?.title ?? "",
  };
}

// Normalize URL
function normalizeUrl(url: string): string {
  url = url.trim();
  if (!url) return "";

  if (url.startsWith("mdbrowse://")) {
    return url;
  }
  
  // If it looks like a URL
  if (url.match(/^https?:\/\//i)) {
    return url;
  }
  
  // If it has a dot but no protocol, assume https
  if (url.includes(".") && !url.includes(" ")) {
    return `https://${url}`;
  }
  
  // Otherwise treat as search (you could use a search engine here)
  return `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
}

// Fetch page content with markdown preference
async function fetchPage(url: string): Promise<PageContent> {
  console.log(`[MDBrowse] Fetching: ${url}`);

  if (url === START_PAGE_URL) {
    if (settings.sendAcceptMd) {
      return {
        url: START_PAGE_URL,
        markdown: START_PAGE_MARKDOWN,
        rawHtml: "",
        title: START_PAGE_TITLE,
        wasMarkdown: true,
      };
    }

    const rawHtml = START_PAGE_HTML;
    const markdown = settings.autoConvert
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
  
  try {
    // Build Accept header based on settings
    const acceptHeader = settings.sendAcceptMd 
      ? "text/markdown, text/x-markdown, text/plain, text/html, */*"
      : "text/html, */*";
    
    const response = await fetch(url, {
      headers: {
        "Accept": acceptHeader,
        "User-Agent": "MDBrowse/1.0 (Markdown Browser)",
      },
      redirect: "follow",
    });
    
    const contentType = response.headers.get("content-type") || "";
    const finalUrl = response.url; // After redirects
    let text = await decodeResponseBody(response, contentType);
    let title = "";
    let wasMarkdown = false;
    let markdown = "";
    let rawHtml = "";
    
    // Check if response is markdown
    if (contentType.includes("text/markdown") || 
        contentType.includes("text/x-markdown") ||
        contentType.includes("text/plain") && !text.trim().startsWith("<!") && !text.trim().startsWith("<html")) {
      // It's markdown (or plain text that isn't HTML)
      wasMarkdown = true;
      markdown = text;
      rawHtml = ""; // No HTML for native markdown
      
      // Try to extract title from first heading
      const headingMatch = markdown.match(/^#\s+(.+)$/m);
      title = headingMatch ? headingMatch[1] : new URL(finalUrl).hostname;
    } else {
      // It's HTML - store raw and optionally convert to markdown
      wasMarkdown = false;
      rawHtml = text;
      
      // Extract title from HTML
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : new URL(finalUrl).hostname;
      
      if (settings.autoConvert) {
        // Clean up HTML before conversion
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
        
        // If there's a main or article tag, use that
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
        
        // Convert to markdown
        markdown = turndown.turndown(cleanHtml);
        
        // Clean up Turndown output (broken links, whitespace, etc.)
        markdown = cleanupTurndownOutput(markdown);
      } else {
        // No auto-convert - expose raw HTML as markdown payload
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
  } catch (error) {
    console.error(`[MDBrowse] Fetch error:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      url,
      markdown: `# Error Loading Page\n\nFailed to load: ${url}\n\n**Error:** ${errorMessage}`,
      rawHtml: `<h1>Error Loading Page</h1><p>Failed to load: ${url}</p><p><strong>Error:</strong> ${errorMessage}</p>`,
      title: "Error",
      wasMarkdown: false,
    };
  }
}

// Send content to the webview
function sendContentToWebview(content: PageContent) {
  const escapedContent = JSON.stringify(content);
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:content', { detail: ${escapedContent} }));
  `);
}

// Send navigation state to the webview
function sendNavigationState() {
  const state = getNavigationState();
  const escapedState = JSON.stringify(state);
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:navState', { detail: ${escapedState} }));
  `);
}

// Send tabs to the webview
function sendTabs() {
  const tabInfos = getTabInfos();
  const escaped = JSON.stringify({ tabs: tabInfos });
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:tabs', { detail: ${escaped} }));
  `);
}

// Send settings to the webview
function sendSettings() {
  const escaped = JSON.stringify(settings);
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:settings', { detail: ${escaped} }));
  `);
}

// Send loading started
function sendLoadingStarted(url: string) {
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:loadingStarted', { detail: { url: ${JSON.stringify(url)} } }));
  `);
}

// Send loading finished
function sendLoadingFinished(url: string, title: string) {
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:loadingFinished', { detail: { url: ${JSON.stringify(url)}, title: ${JSON.stringify(title)} } }));
  `);
}

// Clear content
function sendClearContent() {
  mainWindow.webview.executeJavascript(`
    window.dispatchEvent(new CustomEvent('mdbrowse:clearContent', {}));
  `);
}

// Define RPC for the main window
const mainRPC = BrowserView.defineRPC<ToolbarRPCType>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      navigate: async ({ url }) => {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
          return { success: false, error: "Invalid URL" };
        }
        
        let tab = getActiveTab();
        if (!tab) {
          tab = {
            id: nextTabId++,
            url: "",
            title: "",
            history: [],
            historyIndex: -1,
            isLoading: false,
            content: null,
          };
          tabs.push(tab);
          activeTabId = tab.id;
        }
        
        tab.isLoading = true;
        tab.url = normalizedUrl;
        
        sendNavigationState();
        sendLoadingStarted(normalizedUrl);
        sendTabs();
        sendClearContent();
        
        try {
          const content = await fetchPage(normalizedUrl);
          
          tab.url = content.url;
          tab.title = content.title;
          tab.content = content;
          tab.isLoading = false;
          
          if (tab.historyIndex < tab.history.length - 1) {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
          }
          const lastUrl = tab.history[tab.history.length - 1];
          if (lastUrl !== content.url) {
            tab.history.push(content.url);
          }
          tab.historyIndex = tab.history.length - 1;
          
          sendContentToWebview(content);
          sendNavigationState();
          sendLoadingFinished(content.url, content.title);
          sendTabs();
          
          // Update window title
          mainWindow.setTitle(`${content.title} - MDBrowse`);
          
          return { success: true };
        } catch (error) {
          tab.isLoading = false;
          sendNavigationState();
          return { success: false, error: String(error) };
        }
      },
      
      goBack: async () => {
        const tab = getActiveTab();
        if (!tab || tab.historyIndex <= 0) {
          return { success: false };
        }
        
        tab.historyIndex--;
        const url = tab.history[tab.historyIndex];
        
        tab.isLoading = true;
        tab.url = url;
        sendNavigationState();
        sendLoadingStarted(url);
        sendClearContent();
        
        const content = await fetchPage(url);
        tab.url = content.url;
        tab.title = content.title;
        tab.content = content;
        tab.isLoading = false;
        
        sendContentToWebview(content);
        sendNavigationState();
        sendLoadingFinished(content.url, content.title);
        sendTabs();
        mainWindow.setTitle(`${content.title} - MDBrowse`);
        
        return { success: true };
      },
      
      goForward: async () => {
        const tab = getActiveTab();
        if (!tab || tab.historyIndex >= tab.history.length - 1) {
          return { success: false };
        }
        
        tab.historyIndex++;
        const url = tab.history[tab.historyIndex];
        
        tab.isLoading = true;
        tab.url = url;
        sendNavigationState();
        sendLoadingStarted(url);
        sendClearContent();
        
        const content = await fetchPage(url);
        tab.url = content.url;
        tab.title = content.title;
        tab.content = content;
        tab.isLoading = false;
        
        sendContentToWebview(content);
        sendNavigationState();
        sendLoadingFinished(content.url, content.title);
        sendTabs();
        mainWindow.setTitle(`${content.title} - MDBrowse`);
        
        return { success: true };
      },
      
      reload: async () => {
        const tab = getActiveTab();
        if (!tab || !tab.url) {
          return { success: false };
        }
        
        tab.isLoading = true;
        sendNavigationState();
        sendLoadingStarted(tab.url);
        sendClearContent();
        
        const content = await fetchPage(tab.url);
        tab.title = content.title;
        tab.content = content;
        tab.isLoading = false;
        
        sendContentToWebview(content);
        sendNavigationState();
        sendLoadingFinished(content.url, content.title);
        sendTabs();
        mainWindow.setTitle(`${content.title} - MDBrowse`);
        
        return { success: true };
      },
      
      stopLoading: async () => {
        const tab = getActiveTab();
        if (tab) {
          tab.isLoading = false;
          sendNavigationState();
        }
        return { success: true };
      },
      
      createTab: async ({ url }) => {
        const tab: Tab = {
          id: nextTabId++,
          url: "",
          title: "New Tab",
          history: [],
          historyIndex: -1,
          isLoading: false,
          content: null,
        };
        tabs.push(tab);
        activeTabId = tab.id;
        
        sendTabs();
        sendNavigationState();
        sendClearContent();
        mainWindow.setTitle("New Tab - MDBrowse");
        
        if (url) {
          return mainRPC.handlers.requests.navigate({ url });
        }
        
        return { tabId: tab.id };
      },
      
      closeTab: async ({ tabId }) => {
        const index = tabs.findIndex(t => t.id === tabId);
        if (index === -1) {
          return { success: false };
        }
        
        tabs.splice(index, 1);
        
        if (activeTabId === tabId) {
          if (tabs.length > 0) {
            const newIndex = Math.min(index, tabs.length - 1);
            activeTabId = tabs[newIndex].id;
            const tab = tabs[newIndex];
            
            if (tab.content) {
              sendContentToWebview(tab.content);
              mainWindow.setTitle(`${tab.title} - MDBrowse`);
            } else {
              sendClearContent();
              mainWindow.setTitle("New Tab - MDBrowse");
            }
          } else {
            const newTab: Tab = {
              id: nextTabId++,
              url: "",
              title: "New Tab",
              history: [],
              historyIndex: -1,
              isLoading: false,
              content: null,
            };
            tabs.push(newTab);
            activeTabId = newTab.id;
            sendClearContent();
            mainWindow.setTitle("New Tab - MDBrowse");
          }
        }
        
        sendTabs();
        sendNavigationState();
        
        return { success: true };
      },
      
      switchTab: async ({ tabId }) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) {
          return { success: false };
        }
        
        activeTabId = tabId;
        
        if (tab.content) {
          sendContentToWebview(tab.content);
          mainWindow.setTitle(`${tab.title} - MDBrowse`);
        } else {
          sendClearContent();
          mainWindow.setTitle("New Tab - MDBrowse");
        }
        
        sendTabs();
        sendNavigationState();
        
        return { success: true };
      },
      
      getTabs: async () => {
        return { tabs: getTabInfos() };
      },
      
      getNavigationState: async () => {
        return getNavigationState();
      },
      
      getSettings: async () => {
        return settings;
      },
      
      updateSettings: async (newSettings) => {
        const oldSettings = { ...settings };
        settings = { ...settings, ...newSettings };
        
        // Check if any setting that requires refresh changed
        const needsRefresh = 
          oldSettings.sendAcceptMd !== settings.sendAcceptMd ||
          oldSettings.autoConvert !== settings.autoConvert ||
          oldSettings.allowJavascript !== settings.allowJavascript;
        
        // Send updated settings to webview
        sendSettings();
        
        return { success: true, needsRefresh };
      },
      
      refetchForViewMode: async () => {
        const tab = getActiveTab();
        if (!tab || !tab.url) {
          return { success: false };
        }
        
        tab.isLoading = true;
        sendNavigationState();
        sendLoadingStarted(tab.url);
        
        const content = await fetchPage(tab.url);
        tab.title = content.title;
        tab.content = content;
        tab.isLoading = false;
        
        sendContentToWebview(content);
        sendNavigationState();
        sendLoadingFinished(content.url, content.title);
        sendTabs();
        mainWindow.setTitle(`${content.title} - MDBrowse`);
        
        return { success: true };
      },
      
      // Called when content webview navigates in HTML mode
      onWebviewNavigated: async ({ url }) => {
        const tab = getActiveTab();
        if (!tab) return { success: false };
        
        // Update tab's URL tracking
        tab.url = url;
        
        // Update history index based on navigation direction when possible
        const currentUrl = tab.history[tab.historyIndex] || null;
        const backUrl = tab.historyIndex > 0 ? tab.history[tab.historyIndex - 1] : null;
        const forwardUrl = tab.historyIndex < tab.history.length - 1 ? tab.history[tab.historyIndex + 1] : null;

        if (currentUrl === url) {
          // No-op: same URL as current history entry
        } else if (backUrl === url) {
          tab.historyIndex -= 1;
        } else if (forwardUrl === url) {
          tab.historyIndex += 1;
        } else {
          // Truncate forward history if we're navigating from middle
          if (tab.historyIndex < tab.history.length - 1) {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
          }
          tab.history.push(url);
          tab.historyIndex = tab.history.length - 1;
        }
        
        // Try to get title from URL
        try {
          const urlObj = new URL(url);
          tab.title = urlObj.hostname;
        } catch {
          tab.title = url;
        }
        
        sendNavigationState();
        sendTabs();
        mainWindow.setTitle(`${tab.title} - MDBrowse`);
        
        return { success: true };
      },
    },
    messages: {
      log: ({ msg }) => {
        console.log(`[View] ${msg}`);
      },
    },
  },
});

// Create main window
mainWindow = new BrowserWindow({
  title: "MDBrowse",
  url: "views://toolbar/index.html",
  frame: {
    width: 1200,
    height: 800,
    x: 100,
    y: 100,
  },
  titleBarStyle: 'hiddenInset',
  styleMask: {
    // These are the current defaults
    Borderless: true,
    Titled: false,
    Closable: true,
    Miniaturizable: true,
    Resizable: true,
    UnifiedTitleAndToolbar: true,
    FullScreen: false,
    FullSizeContentView: false,
    UtilityWindow: false,
    DocModalWindow: false,
    NonactivatingPanel: false,
    HUDWindow: false,
  },
  rpc: mainRPC,
});

console.log("[MDBrowse] Window created");

// Handle window close
mainWindow.on("close", () => {
  console.log("[MDBrowse] Window closed");
  Utils.quit();
  process.exit(0);
});

mainWindow.on("closed", () => {
  Utils.quit();
  process.exit(0);
});

// Create initial tab
tabs.push({
  id: nextTabId++,
  url: "",
  title: "New Tab",
  history: [],
  historyIndex: -1,
  isLoading: false,
  content: null,
});
activeTabId = tabs[0].id;

console.log("[MDBrowse] Ready");
