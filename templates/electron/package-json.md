# Template: package.json para Electron (electron-vite)

**tags:** electron, package.json, deps, scripts, electron-vite, vitest
**transversal:** true
**Cuándo usar:** raíz de toda app de escritorio (Electron). Cópialo y ajusta `name`/`description`/`build.appId`. NO inventes las dependencias ni los scripts — usa estos exactos.

`package.json`:
```json
{
  "name": "mi-app",
  "version": "1.0.0",
  "description": "Aplicación de escritorio",
  "main": "./out/main/index.js",
  "author": "AutoCode",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "dist": "electron-vite build && electron-builder"
  },
  "dependencies": {
    "vue": "^3.5.13",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "electron": "^33.2.0",
    "electron-vite": "^2.3.0",
    "electron-builder": "^25.1.8",
    "vite": "^5.4.11",
    "@vitejs/plugin-vue": "^5.2.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5",
    "@types/node": "^22.9.0",
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

## Notas (importantes para que compile y empaquete)
- `"type": "module"` + `"main": "./out/main/index.js"` → electron-vite genera el bundle en `out/`.
- **`better-sqlite3` es nativo** → va en `dependencies` (no se bundlea; se externaliza en la config) y necesita `electron-rebuild`/`@electron/rebuild` al empaquetar. Para SOLO desarrollar/compilar no hace falta.
- Si la app usa **Pinia**, añade `"pinia": "^2.2.6"` a `dependencies`.
- Si parsea/escribe **XML** (p.ej. SEPA), añade `"fast-xml-parser": "^4.5.0"` a `dependencies`.
- Si NO usas SQLite (todo en memoria), **quita** `better-sqlite3` y `@types/better-sqlite3`.
- `test`/`typecheck` ya están listos para el gate de QA.
