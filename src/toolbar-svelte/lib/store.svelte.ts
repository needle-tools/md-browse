// Svelte 5 runes-based store for MDBrowse
import type { AppState, PageContent, TabInfo, ViewMode, BrowserSettings } from "./types";
import { START_PAGE_URL } from "../../shared/start-page";

// Default initial state
const defaultState: AppState = {
  currentUrl: "",
  currentContent: null,
  viewMode: "preview",
  isLoading: false,
  tabs: [],
  canGoBack: false,
  canGoForward: false,
  showWelcome: true,
  searchVisible: false,
  searchQuery: "",
  settings: {
    sendAcceptMd: true,
    autoConvert: true,
    allowJavascript: false,
  },
};

// Create the reactive state using Svelte 5 runes
function createAppStore() {
  // Use $state for reactive state
  let state = $state<AppState>({ ...defaultState });

  return {
    // Getters
    get currentUrl() { return state.currentUrl; },
    get currentContent() { return state.currentContent; },
    get viewMode() { return state.viewMode; },
    get isLoading() { return state.isLoading; },
    get tabs() { return state.tabs; },
    get canGoBack() { return state.canGoBack; },
    get canGoForward() { return state.canGoForward; },
    get showWelcome() { return state.showWelcome; },
    get searchVisible() { return state.searchVisible; },
    get searchQuery() { return state.searchQuery; },
    get settings() { return state.settings; },
    
    // Derived values
    get hasContent() { return state.currentContent !== null; },
    get isMarkdownContent() { return state.currentContent?.wasMarkdown ?? false; },
    
    // Actions
    setUrl(url: string) {
      console.log("[Store] setUrl:", url);
      state.currentUrl = url;
      if (url) {
        state.showWelcome = false;
      }
    },
    
    setContent(content: PageContent | null) {
      console.log("[Store] setContent:", content?.url);
      state.currentContent = content;
      if (content) {
        state.currentUrl = content.url;
        state.showWelcome = false;
      }
    },

    clearContentForLoading() {
      state.currentContent = null;
      state.showWelcome = false;
    },
    
    setViewMode(mode: ViewMode) {
      console.log("[Store] setViewMode:", mode);
      state.viewMode = mode;
    },
    
    setLoading(loading: boolean) {
      state.isLoading = loading;
    },
    
    setTabs(tabs: TabInfo[]) {
      state.tabs = tabs;
    },
    
    setNavigation(canGoBack: boolean, canGoForward: boolean) {
      state.canGoBack = canGoBack;
      state.canGoForward = canGoForward;
    },
    
    showWelcomeScreen() {
      state.showWelcome = true;
      state.currentContent = null;
      state.currentUrl = START_PAGE_URL;
    },
    
    hideWelcomeScreen() {
      state.showWelcome = false;
    },
    
    toggleSearch() {
      state.searchVisible = !state.searchVisible;
      if (!state.searchVisible) {
        state.searchQuery = "";
      }
    },
    
    closeSearch() {
      state.searchVisible = false;
      state.searchQuery = "";
    },
    
    setSearchQuery(query: string) {
      state.searchQuery = query;
    },
    
    updateSettings(newSettings: Partial<BrowserSettings>) {
      state.settings = { ...state.settings, ...newSettings };
    },
    
    // Reset state
    reset() {
      Object.assign(state, { ...defaultState });
    },
  };
}

// Export singleton store
export const appStore = createAppStore();
