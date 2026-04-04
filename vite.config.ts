import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

const entry = process.env.ENTRY || "content";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: entry === "content",
    lib: {
      entry: resolve(__dirname, `src/${entry}.ts`),
      name: entry.replace(/-/g, "_"),
      formats: ["iife"],
      fileName: () => `${entry}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: "content.[ext]",
      },
    },
  },
  // Allow CSS ?inline imports so viewer.css can be bundled as a string
  // directly into content.js. This is required for the sandboxed-page fix:
  // after DOM nuke, styles are re-injected via <style> tag rather than
  // <link href="chrome-extension://..."> which is blocked by CSP on
  // sandboxed pages like raw.githubusercontent.com.
  assetsInclude: [],
  plugins: [
    ...(entry === "content"
      ? [
          viteStaticCopy({
            targets: [
              { src: "manifest.json", dest: "." },
              { src: "icons/*", dest: "icons" },
              { src: "src/pointer-32.png", dest: "." },
            ],
          }),
        ]
      : []),
  ],
});
