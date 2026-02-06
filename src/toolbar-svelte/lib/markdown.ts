// Markdown utilities
import { marked } from "marked";
import type { ParsedFrontmatter } from "./types";
import themeCss from "../styles/theme.css?raw";

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Parse YAML frontmatter from markdown
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const trimmed = markdown.trim();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, content: markdown };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: null, content: markdown };
  }

  const yamlContent = trimmed.substring(4, endIndex).trim();
  const remainingContent = trimmed.substring(endIndex + 4).trim();

  // Parse YAML manually (simple key: value pairs and arrays)
  const frontmatter: Record<string, unknown> = {};
  const lines = yamlContent.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    // Check for array item
    if (trimmedLine.startsWith("- ") && currentKey && currentArray) {
      const value = trimmedLine.substring(2).trim();
      const unquoted = value.replace(/^["']|["']$/g, "");
      currentArray.push(unquoted);
      continue;
    }

    // Check for key: value
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmedLine.substring(0, colonIndex).trim();
      let value = trimmedLine.substring(colonIndex + 1).trim();

      // Save previous array if exists
      if (currentKey && currentArray) {
        frontmatter[currentKey] = currentArray;
      }

      if (value === "" || value === "|" || value === ">") {
        currentKey = key;
        currentArray = [];
      } else {
        value = value.replace(/^["']|["']$/g, "");
        frontmatter[key] = value;
        currentKey = null;
        currentArray = null;
      }
    }
  }

  // Don't forget the last array
  if (currentKey && currentArray) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, content: remainingContent };
}

// Resolve relative URLs
export function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

// Fix relative URLs in markdown
export function fixRelativeUrls(markdown: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);

    // Fix markdown image links
    markdown = markdown.replace(
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|#)([^)]+)\)/g,
      (match, alt, path) => {
        const absoluteUrl = new URL(path, base).href;
        return `![${alt}](${absoluteUrl})`;
      }
    );

    // Fix markdown links
    markdown = markdown.replace(
      /\[([^\]]+)\]\((?!https?:\/\/|data:|#|mailto:)([^)]+)\)/g,
      (match, text, path) => {
        const absoluteUrl = new URL(path, base).href;
        return `[${text}](${absoluteUrl})`;
      }
    );

    return markdown;
  } catch {
    return markdown;
  }
}

// Escape HTML
export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Render frontmatter as HTML table
export function renderFrontmatterTable(frontmatter: Record<string, unknown>, baseUrl: string): string {
  const rows: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    let displayValue: string;

    if (Array.isArray(value)) {
      const items = value.map((item) => {
        if (typeof item === "string" && (item.startsWith("http") || item.startsWith("/") || item.startsWith("./"))) {
          const fullUrl = resolveUrl(baseUrl, item);
          return `<a href="${escapeHtml(fullUrl)}" class="fm-link">${escapeHtml(item)}</a>`;
        }
        return escapeHtml(String(item));
      });
      displayValue = items.join("<br>");
    } else if (typeof value === "string") {
      if (key.toLowerCase() === "url" || value.startsWith("http://") || value.startsWith("https://")) {
        const fullUrl = resolveUrl(baseUrl, value);
        displayValue = `<a href="${escapeHtml(fullUrl)}" class="fm-link">${escapeHtml(value)}</a>`;
      } else if (value.startsWith("/") || value.startsWith("./")) {
        const fullUrl = resolveUrl(baseUrl, value);
        displayValue = `<a href="${escapeHtml(fullUrl)}" class="fm-link">${escapeHtml(value)}</a>`;
      } else {
        displayValue = escapeHtml(value);
      }
    } else {
      displayValue = escapeHtml(String(value));
    }

    rows.push(`<tr><td class="fm-key">${escapeHtml(key)}</td><td class="fm-value">${displayValue}</td></tr>`);
  }

  return `<table class="frontmatter-table">${rows.join("")}</table>`;
}

// Generate full HTML for markdown content
export function generateMarkdownHtml(markdown: string, rawMode: boolean, baseUrl: string, interceptLinks: boolean = false): string {
  const { frontmatter, content } = parseFrontmatter(markdown);

  let frontmatterHtml = "";
  if (!rawMode && frontmatter && Object.keys(frontmatter).length > 0) {
    frontmatterHtml = `<div class="frontmatter-container">${renderFrontmatterTable(frontmatter, baseUrl)}</div>`;
  }

  let bodyContent: string;
  if (rawMode) {
    bodyContent = `<pre class="raw-markdown">${escapeHtml(markdown)}</pre>`;
  } else {
    const fixedContent = fixRelativeUrls(content, baseUrl);
    bodyContent = marked.parse(fixedContent) as string;
    const base = baseUrl.split("#")[0];
    if (base) {
      bodyContent = bodyContent.replace(/href="#([^"]*)"/g, `href="${base}#$1"`);
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${themeCss}
    :root { 
        color-scheme: light dark; 
    }
    body {
      font-family: var(--ui-font, "Monaspace Xenon Var", -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif);
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    h1, h2, h3, h4 { color: var(--text-primary); margin-top: 1.5em; }
    h1 { border-bottom: 2px solid var(--accent); padding-bottom: 0.3em; }
    a { color: var(--accent-text); }
    a:hover { color: var(--accent-2); }
    pre {
      background: var(--bg-input);
      padding: 16px;
      border-radius: var(--border-radius);
      overflow-x: auto;
      border: 1px solid var(--border);
    }
    code {
      background: var(--bg-input);
      padding: 2px 6px;
      border-radius: var(--border-radius-half);
      font-family: 'SF Mono', Monaco, monospace;
    }
    pre code { background: none; padding: 0; }
    blockquote {
      border-left: 4px solid var(--accent);
      margin: 1em 0;
      padding-left: 1em;
      color: var(--text-secondary);
    }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
    th { background: var(--bg-input); }
    .raw-markdown {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 14px;
    }
    .frontmatter-container {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--border-radius);
      margin-bottom: 24px;
    }
    .frontmatter-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .frontmatter-table tr { border-bottom: 1px solid var(--border); }
    .frontmatter-table tr:last-child { border-bottom: none; }
    .frontmatter-table td { padding: 8px 12px; vertical-align: top; border: none; }
    .fm-key { font-weight: 600; color: var(--accent); width: 120px; white-space: nowrap; }
    .fm-value { color: var(--text-primary); }
    .fm-link { color: var(--accent-text); text-decoration: none; }
    .fm-link:hover { color: #ffffff); text-decoration: underline; }
  </style>
</head>
<body>
  ${frontmatterHtml}
  ${bodyContent}
  ${interceptLinks ? `<script>
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    var fullUrl = link.href;
    if (window.parent !== window) {
      window.parent.postMessage({type:'mdbrowse:navigate',url:fullUrl},'*');
    } else {
      window.location.hash = 'nav:' + encodeURIComponent(fullUrl);
    }
  });
  </script>` : ''}
</body>
</html>`;
}
