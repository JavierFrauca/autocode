# ADR-0001 — Stack cerrado: Vue.js + Node.js para AutoCode y para las apps generadas

- **Estado**: aceptado
- **Fecha**: 2026-06-12

## Contexto

AutoCode tiene dos planos:
1. La **herramienta** (lo que el usuario abre).
2. Las **apps que la herramienta genera**.

El usuario final no sabe programar. Cualquier decisión de stack que se le delegue es ruido. Y para generar código de forma fiable con LLMs necesitamos **plantillas pequeñas y conocidas**, no infinitas combinaciones.

## Decisión

Cerramos un único stack, idéntico para AutoCode y para sus apps generadas:

- **Frontend**: Vue.js 3 + TypeScript + Vite.
- **Backend**: Node.js + TypeScript. Framework HTTP: **Fastify** (por rendimiento, esquemas JSON nativos, plugins; Express queda como alternativa si aparece un blocker).
- **Desktop**: Electron.
- **ORM/DB layer**: **Drizzle** sobre PostgreSQL (esquemas tipados, migraciones explícitas, sin el peso de Prisma).
- **Monorepo**: pnpm workspaces.
- **Tests**: Vitest.
- **Lint/format**: Biome (rápido, una sola herramienta).

## Consecuencias

- Las plantillas de generación son pocas y muy probadas → la calidad del código generado sube.
- El usuario nunca elige stack; menos fricción.
- Perdemos flexibilidad: cualquier requisito que pida otro framework se rechaza o se modela como excepción documentada.
- Mismo stack en herramienta y producto significa que el equipo solo mantiene un set de habilidades.

## Alternativas descartadas

- **Next.js / React full-stack**: tentador, pero acopla front a un framework muy opinado y complica Electron.
- **Python (FastAPI) en backend**: el usuario quiere todo Node para simplicidad de despliegue y de generación.
- **Prisma**: más mágico, peor encaja con esquemas multi-tenant evolutivos. Drizzle gana en este caso.
