# Template: electron.vite.config.ts + electron-builder.yml

**tags:** electron, electron-vite, vite, build, electron-builder, vue
**transversal:** true
**Cuándo usar:** raíz de toda app Electron.

`electron.vite.config.ts`:
```typescript
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // better-sqlite3 es nativo: no se bundlea, se carga desde node_modules.
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { "@": resolve("src/renderer/src") },
    },
    plugins: [vue()],
  },
});
```

`electron-builder.yml` (para `npm run dist` — empaquetado):
```yaml
appId: com.autocode.miapp
productName: Mi App
directories:
  output: release
files:
  - out/**
  - package.json
win:
  target: nsis
mac:
  target: dmg
linux:
  target: AppImage
```

## Notas
- `external: ["better-sqlite3"]` evita el error típico de bundlear un módulo nativo. Si NO usas SQLite, quita esa línea.
- El `alias "@"` te deja importar `@/components/Foo.vue` desde el renderer.
- En desarrollo, electron-vite sirve el renderer y pone `process.env.ELECTRON_RENDERER_URL` (lo usa `src/main/index.ts` para `loadURL`); en producción carga `out/renderer/index.html` con `loadFile`.
