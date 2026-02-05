import type { RPCSchema } from "electrobun/bun";

/**
 * Tab information
 */
export interface TabInfo {
  id: number;
  url: string;
  title: string;
  isActive: boolean;
  isLoading: boolean;
}

/**
 * Navigation state
 */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  url: string;
  title: string;
}

/**
 * Browser settings
 */
export interface BrowserSettings {
  sendAcceptMd: boolean;      // Whether to send Accept: text/markdown header
  autoConvert: boolean;       // Whether to auto-convert HTML to markdown
  allowJavascript: boolean;   // Whether to allow JavaScript (for HTML view)
}

/**
 * Page content response from fetching a URL
 */
export interface PageContent {
  url: string;
  markdown: string;
  rawHtml: string;            // Store original HTML for HTML view mode
  title: string;
  wasMarkdown: boolean;       // true if server returned markdown, false if converted from HTML
}

/**
 * RPC types for toolbar <-> bun communication
 */
export type ToolbarRPCType = {
  bun: RPCSchema<{
    requests: {
      // Navigation
      navigate: {
        params: { url: string };
        response: { success: boolean; error?: string };
      };
      goBack: {
        params: {};
        response: { success: boolean };
      };
      goForward: {
        params: {};
        response: { success: boolean };
      };
      reload: {
        params: {};
        response: { success: boolean };
      };
      stopLoading: {
        params: {};
        response: { success: boolean };
      };
      // Re-fetch for view mode switch
      refetchForViewMode: {
        params: {};
        response: { success: boolean };
      };
      // Notify bun when content webview navigates (HTML mode)
      onWebviewNavigated: {
        params: { url: string };
        response: { success: boolean };
      };
      // Tab management
      createTab: {
        params: { url?: string };
        response: { tabId: number };
      };
      closeTab: {
        params: { tabId: number };
        response: { success: boolean };
      };
      switchTab: {
        params: { tabId: number };
        response: { success: boolean };
      };
      getTabs: {
        params: {};
        response: { tabs: TabInfo[] };
      };
      getNavigationState: {
        params: {};
        response: NavigationState;
      };
      // Settings
      getSettings: {
        params: {};
        response: BrowserSettings;
      };
      updateSettings: {
        params: Partial<BrowserSettings>;
        response: { success: boolean; needsRefresh: boolean };
      };
    };
    messages: {
      log: { msg: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      // Navigation state updates
      navigationStateChanged: NavigationState;
      // Tab updates
      tabsChanged: { tabs: TabInfo[] };
      // Loading state
      loadingStarted: { url: string };
      loadingFinished: { url: string; title: string };
      // Settings changed
      settingsChanged: BrowserSettings;
    };
  }>;
};
