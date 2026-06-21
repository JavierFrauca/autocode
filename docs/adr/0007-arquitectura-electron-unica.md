# ADR-0007 — Arquitectura: Electron monopuesto, API embebida

- **Estado**: aceptado — **único ADR-0007 vigente**
- **Fecha**: 2026-06-13 (2026-06-17: se eliminó el fichero del ADR-0007 original "dos formatos" para
  acabar con la colisión de número; su contexto y rationale quedan resumidos abajo)

## Contexto

AutoCode es una herramienta de escritorio monopuesto. El ADR original (2026-06-12) planteaba
dos modos de despliegue —Electron y cliente-servidor— confundiendo la arquitectura de AutoCode
con la arquitectura de las **apps que AutoCode genera** (que sí son cliente-servidor con Docker).

Ese error produjo:
- `apps/web/` duplicando la UI sin propósito
- Dockerfiles para AutoCode que no se usan
- `pnpm` workspaces añadiendo complejidad innecesaria
- Necesidad de dos terminales para desarrollar (`pnpm dev:api` + `pnpm dev:desktop`)

## Decisión

AutoCode es un proyecto npm **único** basado en `electron-vite`. Un solo comando para todo.

### Estructura

```
src/
  main/       ← proceso principal Electron + servidor Fastify embebido
  preload/    ← bridge contextBridge
  renderer/   ← UI Vue 3
prompts/      ← prompts Markdown (extraResources en producción)
```

### Modo de operación

- Electron arranca y ejecuta `startServer()` **en el mismo proceso Node** (sin `child_process.spawn`).
- Fastify escucha en `127.0.0.1:4317` (solo loopback, inaccesible desde la red).
- El renderer Vue se comunica con la API vía `fetch()` al puerto local — sin cambios en el código de UI.
- SQLite y Qdrant viven en `%APPDATA%/AutoCode/` (Windows) o equivalente.

### Comandos

```
npm run dev      # electron-vite dev — abre la app con HMR
npm run build    # electron-vite build — genera out/
npm run package  # build + electron-builder → instalador
npm test         # vitest
```

## Lo que desaparece respecto al ADR anterior

- `apps/web/` — no existía necesidad real
- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.prod.yml` — AutoCode no se dockeriza
- `pnpm` workspaces — un solo `package.json` npm
- ADR-0007 original — decisión incorrecta, sustituida por este documento

## Consecuencias

- Un solo `npm run dev` abre la app completa.
- El 100% de los tests de la API son válidos sin cambiar nada (mismas rutas, mismo código).
- El modo multi-usuario NO está en el roadmap de AutoCode; si alguna vez se necesita,
  se tratará como un proyecto derivado con su propia base de código.
