import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";
import { fileURLToPath } from "url";
import { Buffer } from "buffer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    svelte({
      compilerOptions: {
        runes: true,
      },
    }),
    {
      name: "mdbrowse-proxy",
      configureServer(server) {
        server.middlewares.use("/_proxy", async (req, res) => {
          try {
            const url = new URL(req.url || "", "http://localhost");
            const target = url.searchParams.get("url");
            if (!target) {
              res.statusCode = 400;
              res.end("Missing url");
              return;
            }

            const response = await fetch(target, {
              headers: {
                "User-Agent": "MDBrowse/1.0 (Markdown Browser)",
                "Accept": req.headers["accept"] || "*/*",
              },
              redirect: "follow",
            });

            res.statusCode = response.status;
            res.setHeader("x-final-url", response.url);
            const contentType = response.headers.get("content-type");
            if (contentType) {
              res.setHeader("content-type", contentType);
            }

            const body = await response.arrayBuffer();
            res.end(Buffer.from(body));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      },
    },
  ],
  build: {
    outDir: path.resolve(__dirname, "../toolbar"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
    target: "esnext",
    minify: false,
  },
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./lib"),
    },
  },
});
