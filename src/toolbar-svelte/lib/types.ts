// Types for the MDBrowse application

export type ViewMode = "preview" | "markdown" | "html";

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  isActive: boolean;
  isLoading: boolean;
}

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  url: string;
  title: string;
}

export interface BrowserSettings {
  sendAcceptMd: boolean;
  autoConvert: boolean;
  allowJavascript: boolean;
}

export interface PageContent {
  url: string;
  markdown: string;
  rawHtml: string;
  title: string;
  wasMarkdown: boolean;
}

export interface AppState {
  currentUrl: string;
  currentContent: PageContent | null;
  viewMode: ViewMode;
  isLoading: boolean;
  tabs: TabInfo[];
  canGoBack: boolean;
  canGoForward: boolean;
  showWelcome: boolean;
  searchVisible: boolean;
  searchQuery: string;
  settings: BrowserSettings;
}

// Frontmatter parsing result
export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown> | null;
  content: string;
}
