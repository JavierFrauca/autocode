import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { resolve } from "path";

// Versión de la app (la misma que usa electron-builder para nombrar el instalador). Se lee aquí, en cada
// build, para inyectarla en el código como `__APP_VERSION__` y mostrarla en la UI. `npm run package` sube
// el número (scripts/bump-version.mjs) ANTES de construir, así que cada instalador lleva su versión nueva.
const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")).version as string;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    build: {
      rollupOptions: {
        // Segunda entrada: el worker de embeddings se emite como `out/main/embed-worker.js` junto
        // al `index.js`, para poder lanzarlo con `new Worker(...)` desde el proceso main.
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "embed-worker": resolve(__dirname, "src/main/llm/embed-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [vue()],
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
  },
});
