import TurndownService from "turndown";
// @ts-expect-error - turndown-plugin-gfm has no types in this project
import { gfm } from "turndown-plugin-gfm";

const UNWANTED_ELEMENTS = ["script", "style", "noscript", "iframe", "object", "embed", "meta", "link"];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getLinkLabel(node: any): string {
  const textContent = normalizeWhitespace(String(node?.textContent ?? ""));
  if (textContent) return textContent;

  const ariaLabel = normalizeWhitespace(String(node?.getAttribute?.("aria-label") ?? ""));
  if (ariaLabel) return ariaLabel;

  const title = normalizeWhitespace(String(node?.getAttribute?.("title") ?? ""));
  if (title) return title;

  const img = node?.querySelector?.("img[alt]");
  const imgAlt = normalizeWhitespace(String(img?.getAttribute?.("alt") ?? ""));
  if (imgAlt) return imgAlt;

  return "";
}

export function createTurndownService(): TurndownService {
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
      return !hasHeaders;
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

  turndown.remove(UNWANTED_ELEMENTS);

  turndown.addRule("preserveBlankLinks", {
    filter: (node: any) => {
      return node.nodeName === "A" &&
        node.getAttribute("href") !== null &&
        normalizeWhitespace(String(node.textContent ?? "")) === "";
    },
    replacement: (_content: string, node: any) => {
      const href = String(node?.getAttribute?.("href") ?? "").trim();
      const label = getLinkLabel(node) || href;
      if (!href) return label;
      return `[${label}](${href})`;
    },
  });

  return turndown;
}

export function cleanupTurndownOutput(markdown: string): string {
  // Normalize links: clean whitespace in labels, fix protocol-relative URLs
  markdown = markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text, url) => {
    const cleaned = normalizeWhitespace(String(text ?? ""));
    let normalizedUrl = String(url ?? "");
    // Fix protocol-relative URLs
    if (normalizedUrl.startsWith("//")) normalizedUrl = "https:" + normalizedUrl;
    const label = cleaned || normalizedUrl;
    return label ? `[${label}](${normalizedUrl})` : "";
  });
  // Remove data: URI image references (SVG sprites etc.) that add noise
  markdown = markdown.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "");
  markdown = markdown.replace(/\[[^\]]*\]\(data:[^)]+\)/g, "");
  markdown = markdown.replace(/^\d+\.\s*$/gm, "");
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  return markdown.trim();
}
