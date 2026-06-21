# Tareas programadas (jobs / cron)

**Categoría:** integraciones | **Cuándo usar:** sincronizaciones periódicas, limpiezas, recordatorios,
recálculos nocturnos. El tipo de app **`api`** ya trae `src/jobs.ts` de serie; en una app **web (`server`)**
añádelo igual cuando el plan lo pida. Para horarios concretos (cron) usa `node-cron`; para intervalos
simples basta `setInterval` (sin dependencias).

## Patrón sin dependencias (intervalos + "a tal hora")

```ts
// src/jobs.ts — se arranca desde server.ts con startJobs()
export function startJobs(): void {
  cada(60 * 60 * 1000, tareaHoraria);   // cada hora
  cadaDiaA(3, 0, limpiezaNocturna);     // todos los días a las 03:00
}

function cada(ms: number, fn: () => Promise<void> | void): void {
  const t = setInterval(() => Promise.resolve(fn()).catch((e) => console.error("[job]", e)), ms);
  if (typeof t.unref === "function") t.unref(); // no impide cerrar el proceso
}

function cadaDiaA(hora: number, min: number, fn: () => Promise<void> | void): void {
  const ahora = new Date();
  const prox = new Date(ahora);
  prox.setHours(hora, min, 0, 0);
  if (prox <= ahora) prox.setDate(prox.getDate() + 1);
  setTimeout(() => { void Promise.resolve(fn()).catch((e) => console.error("[job]", e)); cada(86_400_000, fn); },
    prox.getTime() - ahora.getTime());
}

async function tareaHoraria(): Promise<void> { /* … sincroniza/limpia … */ }
async function limpiezaNocturna(): Promise<void> { /* … */ }
```

Y en `server.ts` (web): `import { startJobs } from "./jobs.js";` y llama `startJobs();` tras montar las rutas.

## Reglas

- **Idempotente y a prueba de fallos**: cada ejecución atrapa sus errores (un ciclo que falla no debe tumbar
  el proceso ni parar los siguientes). No solapes ejecuciones largas (usa un flag "en curso" si hace falta).
- **Es por proceso**: si escalas a varias réplicas, un cron se ejecutaría en cada una → usa un lock en BD o
  un único worker. Para producción seria considera una cola (BullMQ/Redis) o el cron del sistema.
- **Horarios concretos** ("cada lunes 8:00") → `node-cron`:

```
npm install node-cron
```

Relacionado: tipo `api` (`templates/api-server/src/jobs.ts`), almacenamiento `library/integraciones/almacenamiento-ficheros.md`.
