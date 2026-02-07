/**
 * Comprehensive comparison tests: turndown output vs expected content.
 * 
 * For each URL we:
 * 1. Fetch the page HTML
 * 2. Convert with our turndown
 * 3. Verify key links, headings, and text are present
 *    (matching what a reference fetch tool would extract)
 */
import assert from "node:assert/strict";
import { createTurndownService, cleanupTurndownOutput } from "../src/shared/turndown";
import { START_PAGE_HTML, START_PAGE_MARKDOWN } from "../src/shared/start-page";

const td = createTurndownService();

function convert(html: string): string {
  return cleanupTurndownOutput(td.turndown(html));
}

function extractLinks(md: string): Array<{ label: string; url: string }> {
  return [...md.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => ({
    label: m[1].trim(),
    url: m[2].trim().replace(/\s+"[^"]*"$/, ""), // strip title attr
  }));
}

function extractHeadings(md: string): string[] {
  return [...md.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => m[2].trim());
}

function hasLinkTo(links: Array<{ label: string; url: string }>, urlPattern: string | RegExp): boolean {
  if (typeof urlPattern === "string") {
    return links.some((l) => l.url.includes(urlPattern));
  }
  return links.some((l) => urlPattern.test(l.url));
}

function hasLinkWithLabel(links: Array<{ label: string; url: string }>, labelPattern: string | RegExp): boolean {
  if (typeof labelPattern === "string") {
    return links.some((l) => l.label.toLowerCase().includes(labelPattern.toLowerCase()));
  }
  return links.some((l) => labelPattern.test(l.label));
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  assert.ok(resp.ok, `Failed to fetch ${url}: ${resp.status}`);
  return await resp.text();
}

type TestCase = { name: string; run: () => Promise<void> | void };
const tests: TestCase[] = [];
function test(name: string, run: TestCase["run"]) { tests.push({ name, run }); }

// ── Start page parity ──────────────────────────────────────────
test("start page: markdown ↔ turndown link parity", () => {
  const mdLinks = extractLinks(START_PAGE_MARKDOWN);
  const tdLinks = extractLinks(convert(START_PAGE_HTML));
  const mdUrls = new Set(mdLinks.map((l) => l.url));
  const tdUrls = new Set(tdLinks.map((l) => l.url));
  for (const u of mdUrls) assert.ok(tdUrls.has(u), `Missing in turndown: ${u}`);
  for (const u of tdUrls) assert.ok(mdUrls.has(u), `Extra in turndown: ${u}`);
});

// ── Hacker News ────────────────────────────────────────────────
test("news.ycombinator.com: article links present", async () => {
  const html = await fetchHtml("https://news.ycombinator.com");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch tool shows 30 article links on the front page
  // Turndown should capture all of them
  const externalLinks = links.filter((l) =>
    l.url.startsWith("http") && !l.url.includes("news.ycombinator.com") && !l.url.includes("ycombinator.com/")
  );
  assert.ok(externalLinks.length >= 20, `Expected ≥20 external article links, got ${externalLinks.length}`);
});

test("news.ycombinator.com: navigation links present", async () => {
  const html = await fetchHtml("https://news.ycombinator.com");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows nav links: new, past, comments, ask, show, jobs, submit, login
  assert.ok(hasLinkWithLabel(links, "Hacker News"), "Missing 'Hacker News' link");
  assert.ok(hasLinkWithLabel(links, /^new$/i), "Missing 'new' link");
});

test("news.ycombinator.com: footer links present", async () => {
  const html = await fetchHtml("https://news.ycombinator.com");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows footer: Guidelines, FAQ, Lists, API, Security, Legal, Apply to YC, Contact
  assert.ok(hasLinkWithLabel(links, "Guidelines"), "Missing 'Guidelines' link");
  assert.ok(hasLinkWithLabel(links, "FAQ"), "Missing 'FAQ' link");
  assert.ok(hasLinkTo(links, "github.com/HackerNews/API"), "Missing API link");
});

// ── Wikipedia ──────────────────────────────────────────────────
test("wikipedia.org: language links present", async () => {
  const html = await fetchHtml("https://www.wikipedia.org");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows language links: English, Deutsch, Français, Español, etc.
  assert.ok(hasLinkTo(links, "en.wikipedia.org"), "Missing English Wikipedia link");
  assert.ok(hasLinkTo(links, "de.wikipedia.org"), "Missing German Wikipedia link");
  assert.ok(hasLinkTo(links, "fr.wikipedia.org"), "Missing French Wikipedia link");
  assert.ok(hasLinkTo(links, "es.wikipedia.org"), "Missing Spanish Wikipedia link");
  assert.ok(hasLinkTo(links, "ja.wikipedia.org"), "Missing Japanese Wikipedia link");
  assert.ok(hasLinkTo(links, "ru.wikipedia.org"), "Missing Russian Wikipedia link");
  assert.ok(hasLinkTo(links, "zh.wikipedia.org"), "Missing Chinese Wikipedia link");
  assert.ok(hasLinkTo(links, "pt.wikipedia.org"), "Missing Portuguese Wikipedia link");
});

test("wikipedia.org: wikimedia project links present", async () => {
  const html = await fetchHtml("https://www.wikipedia.org");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows: Commons, Wikivoyage, Wiktionary, Wikibooks, Wikinews, Wikidata, etc.
  assert.ok(hasLinkTo(links, "commons.wikimedia.org"), "Missing Commons link");
  assert.ok(hasLinkTo(links, "wikivoyage.org"), "Missing Wikivoyage link");
  assert.ok(hasLinkTo(links, "wiktionary.org"), "Missing Wiktionary link");
  assert.ok(hasLinkTo(links, "wikibooks.org"), "Missing Wikibooks link");
  assert.ok(hasLinkTo(links, "wikidata.org"), "Missing Wikidata link");
});

test("wikipedia.org: headings present", async () => {
  const html = await fetchHtml("https://www.wikipedia.org");
  const md = convert(html);
  const headings = extractHeadings(md);

  assert.ok(
    headings.some((h) => h.toLowerCase().includes("wikipedia")),
    "Missing Wikipedia heading"
  );
});

test("wikipedia.org: protocol-relative URLs normalized", async () => {
  const html = await fetchHtml("https://www.wikipedia.org");
  const md = convert(html);

  // Protocol-relative URLs (//en.wikipedia.org/) should be normalized to https://
  assert.ok(!md.includes("](//"), "Found un-normalized protocol-relative URL");
});

// ── needle.tools ───────────────────────────────────────────────
test("needle.tools: section headings present", async () => {
  const html = await fetchHtml("https://needle.tools");
  const md = convert(html);
  const headings = extractHeadings(md);

  // My fetch shows these section headings
  const expected = [
    "Built for Speed",
    "Best of Both Worlds",
    "Everywhere Actions",
    "Lightmapping",
    "Materials and Shaders",
    "Optimization",
    "Works Everywhere",
    "Community",
  ];
  for (const h of expected) {
    assert.ok(
      headings.some((heading) => heading.toLowerCase().includes(h.toLowerCase().split(" ")[0])),
      `Missing heading containing "${h}"`
    );
  }
});

test("needle.tools: key content links present", async () => {
  const html = await fetchHtml("https://needle.tools");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows these important links
  assert.ok(hasLinkWithLabel(links, "Needle Engine for Unity"), "Missing Unity link");
  assert.ok(hasLinkWithLabel(links, "Needle Engine for Blender"), "Missing Blender link");
  assert.ok(hasLinkWithLabel(links, /get started/i), "Missing 'Get started' link");
  assert.ok(hasLinkWithLabel(links, /pricing/i), "Missing 'Pricing' link");
  assert.ok(hasLinkTo(links, "engine.needle.tools/docs"), "Missing docs link");
  assert.ok(hasLinkTo(links, "engine.needle.tools/samples"), "Missing samples link");
});

test("needle.tools: community/footer links present", async () => {
  const html = await fetchHtml("https://needle.tools");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows footer/community links
  assert.ok(hasLinkTo(links, "forum.needle.tools"), "Missing forum link");
  assert.ok(hasLinkTo(links, "discord.needle.tools"), "Missing discord link");
  assert.ok(hasLinkTo(links, "x.com/needletools"), "Missing Twitter/X link");
  assert.ok(hasLinkTo(links, "youtube.com/@needle-tools"), "Missing YouTube link");
});

// ── engine.needle.tools/samples ─────────────────────────────────
test("engine.needle.tools/samples: sample links present", async () => {
  const html = await fetchHtml("https://engine.needle.tools/samples/");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows 100+ sample links (may be relative /samples/xxx or absolute)
  const sampleLinks = links.filter((l) =>
    l.url.includes("/samples/") && l.url !== "/samples/" && l.url !== "/samples"
  );
  assert.ok(sampleLinks.length >= 50, `Expected ≥50 sample links, got ${sampleLinks.length}`);

  // Specific samples from my fetch output
  assert.ok(hasLinkTo(links, "/samples/castle-builder"), "Missing Castle Builder sample");
  assert.ok(hasLinkTo(links, "/samples/face-filter"), "Missing Face Filter sample");
  assert.ok(hasLinkTo(links, "/samples/gaussian-splatting"), "Missing Gaussian Splatting sample");
  assert.ok(hasLinkTo(links, "/samples/react-sample"), "Missing React Sample");
  assert.ok(hasLinkTo(links, "/samples/sveltekit-integration"), "Missing SvelteKit sample");
});

test("engine.needle.tools/samples: category headings present", async () => {
  const html = await fetchHtml("https://engine.needle.tools/samples/");
  const md = convert(html);
  const headings = extractHeadings(md);

  // My fetch shows these category sections
  assert.ok(headings.some((h) => h.includes("Trusted")), "Missing 'Trusted by' heading");
});

test("engine.needle.tools/samples: download/nav links", async () => {
  const html = await fetchHtml("https://engine.needle.tools/samples/");
  const md = convert(html);
  const links = extractLinks(md);

  // My fetch shows: Get Started, Download For Unity, Download For Blender, Forum, Discord, etc.
  assert.ok(hasLinkTo(links, "docs.needle.tools/getting-started"), "Missing 'Get Started' link");
  assert.ok(hasLinkTo(links, "engine.needle.tools/downloads/unity"), "Missing Unity download");
  assert.ok(hasLinkTo(links, "engine.needle.tools/downloads/blender"), "Missing Blender download");
  assert.ok(hasLinkTo(links, "forum.needle.tools"), "Missing forum link");
  assert.ok(hasLinkTo(links, "discord.needle.tools"), "Missing discord link");
});

// ── Run all tests ──────────────────────────────────────────────
let failed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${(error as Error).message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
if (failed > 0) process.exit(1);
