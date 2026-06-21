# Andamiaje Electron — estructura dorada (electron-vite + Vue + TypeScript)

**tags:** electron, electron-vite, vue, typescript, desktop, escritorio, sqlite, andamiaje, scaffold
**transversal:** true
**Cuándo usar:** SIEMPRE que el tipo de app sea **escritorio (Electron)**. Es el cimiento: copia estas plantillas TAL CUAL para arrancar, y solo después añades la lógica de negocio.

## Por qué este andamiaje (y no `tsc && electron .`)

Generar Electron a mano (`tsc && electron .` con un tsconfig inventado) falla siempre: el `tsconfig` del renderer se queda sin `"lib": ["dom"]` → cientos de errores `Cannot find name 'document' / 'window' / 'HTMLElement'`. **electron-vite** resuelve eso: compila main/preload/renderer por separado, con su tsconfig correcto cada uno, y empaqueta. Es lo que usa AutoCode internamente.

## Estructura de carpetas OBLIGATORIA

```
.
├── package.json                 ← ver plantilla package-json
├── electron.vite.config.ts      ← ver plantilla electron-vite-config
├── electron-builder.yml         ← empaquetado (dist)
├── tsconfig.json                ← UNO solo: lib ["ES2022","DOM"] + types ["node"]  ← la clave
├── src/
│   ├── main/                    ← Proceso principal (Node). Hexagonal:
│   │   ├── index.ts             ← entrada: crea ventana + registra IPC
│   │   ├── domain/              ← entidades, puertos, errores (sin imports de framework)
│   │   │   ├── entities/
│   │   │   └── ports/
│   │   ├── application/         ← casos de uso (commands/queries + handlers)
│   │   ├── infrastructure/      ← repos (better-sqlite3/Drizzle), adaptadores
│   │   └── adapters/
│   │       └── ipc/             ← ADAPTADOR DE ENTRADA (= rutas HTTP en server, aquí IPC)
│   │           └── index.ts     ← ipcMain.handle(...) → llama a los handlers de application/
│   ├── preload/
│   │   ├── index.ts             ← contextBridge: expone una API tipada al renderer
│   │   └── index.d.ts           ← declara window.api para el renderer
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.ts          ← createApp(App).mount('#app')
│           ├── App.vue
│           ├── shims-vue.d.ts    ← declara `*.vue` (sin esto, importar componentes no compila)
│           ├── components/
│           ├── views/
│           └── stores/          ← Pinia (si hace falta)
└── tests/                       ← propiedad de QA (no la toca el coder)
```

## Hexagonal en Electron (vs servidor)

La arquitectura hexagonal es la misma; **solo cambia el adaptador de entrada**:

| Capa | Servidor (Fastify) | **Electron** |
|---|---|---|
| Entrada (adapter) | rutas HTTP `app.post(...)` | **IPC**: `ipcMain.handle("caso:accion", ...)` en `src/main/adapters/ipc/` |
| Llamada desde UI | `fetch('/api/...')` | `window.api.accion(...)` (expuesto por el preload) |
| application/ | igual (commands/queries + handlers) | **igual** |
| domain/ | igual (entidades + puertos) | **igual** |
| infrastructure/ | repos Drizzle/Postgres | repos **better-sqlite3** (monopuesto) |

**Regla:** el `ipcMain.handle` SOLO traduce (recibe args del renderer, llama al handler de `application/`, devuelve el resultado). Nada de lógica de negocio en el IPC, igual que nada de lógica en una ruta Fastify.

## Flujo de datos (de la UI al dominio)

```
App.vue  →  window.api.abrirFichero()        (renderer)
         →  preload expone api.abrirFichero = ipcRenderer.invoke("fichero:abrir")
         →  src/main/adapters/ipc → ipcMain.handle("fichero:abrir") → AbrirFicheroHandler.handle()
         →  application/  →  domain/  +  infrastructure/ (repo SQLite)
```

## Cómo arrancar (el agente)

1. Copia `package.json`, los tres `tsconfig.*`, `electron.vite.config.ts`, `electron-builder.yml`.
2. Copia `src/main/index.ts`, `src/preload/index.ts` (+ `.d.ts`), `src/renderer/` (index.html + main.ts + App.vue).
3. **Compila YA** (debe estar en verde antes de añadir lógica).
4. Por cada caso de uso del plan: define entidad/puerto en `domain/`, handler en `application/`, repo en `infrastructure/`, **una entrada IPC** en `adapters/ipc/` y **una entrada en el preload** (`api.xxx`), y la llamada desde la UI con `window.api.xxx`.

Persistencia monopuesto → **better-sqlite3** (ver `library/persistencia/sqlite-crud.md`).
