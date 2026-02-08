# `md-browse`

A markdown-first browser built with Electrobun. md-browse prioritizes markdown content when fetching web pages, and converts HTML to clean markdown similar to what AI tools do.

For pages that respect `Accept: text/markdown` headers, it directly displays that data, like the Vercel docs:  

<img width="1060" height="765" alt="Screenshot 2026-02-08 at 01 55 16" src="https://github.com/user-attachments/assets/1e8510a4-3449-48cb-9585-327ad80c2e4a" />


For regular HTML, it passes the page through `turndown` with settings that aim to match what Copilot, Claude etc. do:  

<img width="1060" height="762" alt="Screenshot 2026-02-08 at 01 55 37" src="https://github.com/user-attachments/assets/87c4d883-2123-44b8-b32b-c68268d0948a" />


## Features

- **Markdown-First**: Sends `Accept: text/markdown` headers first to get native markdown when available

- **HTML to Markdown**: Automatically converts HTML pages to clean, readable markdown using Turndown, tuned to match what AIs see
- **Dual View Mode**: Toggle between raw markdown view and rendered preview
- **Tab Support**: Multiple tabs with full navigation history (back/forward)
- **Clean Design**: Dark, modern UI focused on readability

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime
- macOS (for native app development)

### Setup

```bash
# Install dependencies
bun install

# Run in development mode
bun run start
```

### Build

```bash
# Build the application (current platform)
bun run build

# Build Windows x64 artifacts
bun run build:stable:win
```

## Architecture

The app consists of:

- **Bun Process** (`src/bun/index.ts`): Main process that handles:
  - HTTP requests with markdown-priority Accept headers
  - HTML to Markdown conversion using Turndown
  - Tab and navigation state management
  - RPC communication with the view

- **Toolbar View** (`src/toolbar-svelte/` → compiled to `src/toolbar/`): Single view containing:
  - Tab bar for managing multiple tabs
  - Navigation controls (back, forward, reload)
  - URL input bar
  - Markdown/Preview toggle switch
  - Content display area (raw markdown or rendered preview)

## How It Works

1. When you enter a URL, the app fetches it with `Accept: text/markdown` header first
2. If the server returns markdown content, it's displayed directly
3. If HTML is returned, Turndown converts it to clean markdown:
   - Strips scripts, styles, navigation, footers
   - Extracts main content from `<main>` or `<article>` tags
   - Converts headings, links, lists, code blocks, etc.
4. Toggle between "Markdown" (raw) and "Preview" (rendered) views
