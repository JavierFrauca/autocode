# Aplicación de escritorio

App de Electron monopuesto (un usuario, un equipo): Vue en el renderer, SQLite embebido en el proceso
principal. Sin login ni auditoría — son cosas de apps compartidas/web, no de una app local.

## Arrancar en local

```bash
npm install
npm run dev
```

`npm install` reconstruye los módulos nativos (`better-sqlite3`) para Electron automáticamente
(`postinstall`). Si algo falla al arrancar por un módulo nativo, vuelve a lanzar `npm install`.

## Empaquetar un instalador

```bash
npm run dist
```

Genera el instalador en `release/` (config en `electron-builder.yml`). El nombre del instalable sale de
`name`/`description` en `package.json`.

## Qué incluye

- `src/main/index.ts` — proceso principal: ventana, IPC.
- `src/main/db.ts` (+ `src/main/repos/`) — SQLite embebido, patrón *repository* (`items` de ejemplo).
- `src/preload/` — puente seguro renderer↔main (`contextIsolation`); el renderer solo ve `window.api`.
- `src/renderer/src/` — Vue: `App.vue` (cáscara con menú lateral, deriva del router), `router.ts`
  (añade pantallas aquí con `meta.menu` y aparecen solas en el menú), `views/InicioView.vue` (placeholder
  a sustituir por la primera pantalla real).

## Producción

`npm run dist` produce un instalador nativo (Windows/Mac/Linux según `electron-builder.yml`) que el
usuario final instala igual que cualquier otra app de escritorio — no hace falta servidor ni Docker.
