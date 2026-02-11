import type { ElectrobunConfig } from "electrobun";

const config: ElectrobunConfig = {
  app: {
    name: "md-browse",
    identifier: "tools.needle.md-browse",
    version: "1.0.0",
  },

  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      external: [],
    },
    views: {
      // Toolbar view is pre-built by Vite/Svelte
      // So we just copy the compiled files
    },
    copy: {
      // Copy the pre-built toolbar files (built by Vite from Svelte)
      "src/toolbar/index.html": "views/toolbar/index.html",
      "src/toolbar/index.js": "views/toolbar/index.js",
      "src/toolbar/index.css": "views/toolbar/index.css",
      "src/toolbar/iAWriterDuoV.ttf": "views/toolbar/iAWriterDuoV.ttf",
      "src/toolbar/iAWriterDuoV-Italic.ttf": "views/toolbar/iAWriterDuoV-Italic.ttf",
    },
    mac: {
      codesign: true,
      notarize: true,
      bundleCEF: false,
      icons: "assets/icon.iconset",
    },
    linux: {
      bundleCEF: true,
    },
  },

  release: {
    bucketUrl: process.env.ELECTROBUN_BUCKET_URL || "",
  },
  scripts: {
    postWrap: "scripts/postWrap.ts",
  },
};

export default config;
