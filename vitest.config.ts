import { defineConfig } from "vitest/config";
import { resolve } from "path";

// vitest no lee electron.vite.config.ts, así que replicamos el alias `@shared` para que los imports
// de VALOR (p.ej. EMBEDDINGS_DIM) se resuelvan en los tests. (Antes todos los `@shared` eran
// `import type`, que se borran en runtime y nunca necesitaron alias.)
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
