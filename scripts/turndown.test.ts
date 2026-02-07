import assert from "node:assert/strict";
import { createTurndownService, cleanupTurndownOutput } from "../src/shared/turndown";
import { START_PAGE_HTML, START_PAGE_MARKDOWN } from "../src/shared/start-page";

const turndown = createTurndownService();

function convertHtmlToMarkdown(html: string): string {
  return cleanupTurndownOutput(turndown.turndown(html));
}

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const tests: TestCase[] = [];

function test(name: string, run: TestCase["run"]) {
  tests.push({ name, run });
}

function countMarkdownLinks(markdown: string): number {
  return Array.from(markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)).length;
}

function extractMarkdownLinks(markdown: string): Array<{ label: string; url: string }> {
  return Array.from(markdown.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)).map((match) => ({
    label: match[1].trim(),
    url: match[2].trim(),
  }));
}

test("preserves aria-label links", () => {
  const html = `<a href="https://example.com" aria-label="Example"></a>`;
  const md = convertHtmlToMarkdown(html);
  assert.ok(md.includes("[Example](https://example.com)"));
});

test("preserves image-alt links", () => {
  const html = `<a href="/samples"><img src="logo.png" alt="needle tools logo"></a>`;
  const md = convertHtmlToMarkdown(html);
  assert.ok(md.includes("[needle tools logo](/samples)"));
});

test("falls back to href for empty links", () => {
  const html = `<a href="https://example.com"></a>`;
  const md = convertHtmlToMarkdown(html);
  assert.ok(md.includes("[https://example.com](https://example.com)"));
});

test("normalizes multiline link text", () => {
  const html = `<a href="https://example.com">\n  Example\n</a>`;
  const md = convertHtmlToMarkdown(html);
  assert.ok(md.includes("[Example](https://example.com)"));
});

test("engine samples retain meaningful links", async () => {
  const url = "https://engine.needle.tools/samples/";
  const response = await fetch(url);
  assert.ok(response.ok, `Failed to fetch ${url}: ${response.status}`);
  const html = await response.text();

  const markdown = convertHtmlToMarkdown(html);

  const linkCount = countMarkdownLinks(markdown);
  assert.ok(linkCount >= 20, `Expected at least 20 links, got ${linkCount}`);

  const lowered = markdown.toLowerCase();
  assert.ok(lowered.includes("[needle tools logo](/samples)"), "Missing logo link label");

  const unityRegex = /\[download for unity\]\(https:\/\/engine\.needle\.tools\/downloads\/unity\/samples(?:\s+"[^"]+")?\)/i;
  const blenderRegex = /\[download for blender\]\(https:\/\/engine\.needle\.tools\/downloads\/blender\/download-samples(?:\s+"[^"]+")?\)/i;

  assert.ok(unityRegex.test(markdown), "Missing Unity download link");
  assert.ok(blenderRegex.test(markdown), "Missing Blender download link");
});

test("start page markdown links match turndown", () => {
  const markdownLinks = extractMarkdownLinks(START_PAGE_MARKDOWN);
  const turndownLinks = extractMarkdownLinks(convertHtmlToMarkdown(START_PAGE_HTML));

  const markdownUrls = new Set(markdownLinks.map((link) => link.url));
  const turndownUrls = new Set(turndownLinks.map((link) => link.url));

  for (const url of markdownUrls) {
    assert.ok(turndownUrls.has(url), `Missing link in turndown output: ${url}`);
  }

  for (const url of turndownUrls) {
    assert.ok(markdownUrls.has(url), `Unexpected link in turndown output: ${url}`);
  }
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All ${tests.length} tests passed.`);
