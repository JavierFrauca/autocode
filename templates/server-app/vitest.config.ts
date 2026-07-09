import { defineConfig } from "vitest/config";

/**
 * Config de vitest PROPIA y separada de `vite.config.ts` (ese fija `root: "web"` para el build del
 * frontend — si vitest lo heredase, buscaría los tests dentro de `web/` y no encontraría `tests/`).
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
