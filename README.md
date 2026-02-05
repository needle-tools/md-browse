# MDBrowse

A markdown-first browser built with Electrobun. MDBrowse prioritizes markdown content when fetching web pages, and converts HTML to clean markdown for a distraction-free reading experience.

## Features

- **Markdown-First**: Sends `Accept: text/markdown` headers first to get native markdown when available
- **HTML to Markdown**: Automatically converts HTML pages to clean, readable markdown using Turndown
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
bun start
```

### Build

```bash
# Build the application
bun run build
```

## Architecture

The app consists of:

- **Bun Process** (`src/bun/index.ts`): Main process that handles:
  - HTTP requests with markdown-priority Accept headers
  - HTML to Markdown conversion using Turndown
  - Tab and navigation state management
  - RPC communication with the view

- **Toolbar View** (`src/toolbar/`): Single view containing:
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

## License

MIT
