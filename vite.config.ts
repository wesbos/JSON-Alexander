import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

const entry = process.env.ENTRY || "content";
const target = process.env.TARGET || "chrome";
const isFirefox = target === "firefox";

export default defineConfig({
  build: {
    outDir: isFirefox ? "dist-firefox" : "dist-chrome",
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
  plugins: [
    ...(entry === "content"
      ? [
          viteStaticCopy({
            targets: [
              {
                src: isFirefox ? "manifest.firefox.json" : "manifest.chrome.json",
                dest: ".",
                rename: "manifest.json",
              },
              { src: "icons/*", dest: "icons" },
              { src: "src/pointer-32.png", dest: "." },
            ],
          }),
        ]
      : []),
  ],
});
