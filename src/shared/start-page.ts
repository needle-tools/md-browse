export const START_PAGE_URL = "mdbrowse://start";
export const START_PAGE_TITLE = "MDBrowse";

export const START_PAGE_MARKDOWN = `# MDBrowse

A markdown-first browser. Choose a destination:

- [docs.vercel.com](https://docs.vercel.com)
- [docs.needle.tools](https://docs.needle.tools)
- [needle.tools](https://needle.tools)
- [samples.needle.tools](https://samples.needle.tools)
- [github.com](https://github.com)
- [wikipedia.org](https://wikipedia.org)
- [google.com](https://google.com)
- [news.ycombinator.com](https://news.ycombinator.com)
`;

export const START_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>MDBrowse</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
      margin: 0;
      padding: 32px 28px;
      line-height: 1.6;
      background: #ffffff;
      color: #1a1a1a;
    }
    h1 { margin: 0 0 8px 0; }
    p { margin: 8px 0 16px 0; }
    ul { margin: 0 0 20px 18px; padding: 0; }
    li { margin: 6px 0; }
    a { color: #007acc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.9em;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(128, 128, 128, 0.15);
      border: 1px solid rgba(128, 128, 128, 0.25);
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
      a { color: #4db8ff; }
      kbd { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.2); }
    }
  </style>
</head>
<body>
  <h1>MDBrowse</h1>
  <p>A markdown-first browser. Choose a destination:</p>
  <ul>
    <li><a href="https://docs.vercel.com">docs.vercel.com</a></li>
    <li><a href="https://docs.needle.tools">docs.needle.tools</a></li>
    <li><a href="https://needle.tools">needle.tools</a></li>
    <li><a href="https://samples.needle.tools">samples.needle.tools</a></li>
    <li><a href="https://github.com">github.com</a></li>
    <li><a href="https://wikipedia.org">wikipedia.org</a></li>
    <li><a href="https://google.com">google.com</a></li>
    <li><a href="https://news.ycombinator.com">news.ycombinator.com</a></li>
  </ul>
</body>
</html>
`;
