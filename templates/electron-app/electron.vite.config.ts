import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

// Config de electron-vite: empaqueta main, preload y renderer correctamente (rutas, base, CSP) — por
// eso NO hay pantalla en blanco ni hay que copiar html a mano: Vite emite el renderer a out/renderer.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: { "@": resolve("src/renderer/src") },
    },
    plugins: [vue()],
  },
});
