import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const here = dirname(fileURLToPath(import.meta.url));

// El frontend Vue vive en `web/` y se construye a `dist/public`, que el servidor Fastify sirve como
// estáticos. Un solo proceso, un solo puerto: por eso un usuario puede "Probar" la app sin montar nada.
export default defineConfig({
  root: resolve(here, "web"),
  plugins: [vue()],
  build: {
    outDir: resolve(here, "dist/public"),
    emptyOutDir: true,
  },
});
