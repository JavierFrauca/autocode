# Configuración y secretos por entorno

**Categoría:** seguridad | **Cuándo usar:** toda app. Centraliza la configuración, valida el entorno al arrancar y mantén los secretos fuera del repositorio.

## Principios
- **Un único módulo `config`** que lee `process.env`, lo **valida** y exporta valores tipados. El resto del código importa de ahí, nunca lee `process.env` suelto.
- **Falla rápido**: si falta una variable obligatoria, la app no arranca (mejor que un `undefined` silencioso reventando en producción).
- **Secretos fuera del repo**: `.env` en `.gitignore`; `.env.example` versionado con las claves (sin valores).

## Config validada con Zod
```typescript
// src/config.ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres"),
});

// Valida al cargar el módulo: si algo falta o es inválido, lanza con un mensaje claro.
const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuración inválida:", parsed.error.flatten().fieldErrors);
  throw new Error("Revisa las variables de entorno (.env)");
}

export const config = parsed.data;
export type Config = z.infer<typeof EnvSchema>;
```

## Uso (nadie más toca process.env)
```typescript
import { config } from "./config.js";

app.listen({ port: config.PORT, host: "0.0.0.0" });
```

## .env.example (SE commitea)
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/miapp
JWT_SECRET=cambia-esto-por-un-secreto-largo-de-verdad
```

## .gitignore
```
.env
.env.local
```

## Reglas
- **Nunca** hardcodees secretos ni los loguees (ver `library/integraciones/logging`).
- `z.coerce.number()` porque el entorno siempre llega como string.
- En Electron monopuesto los "secretos" suelen ser rutas/flags locales: el mismo patrón vale, leyendo de un fichero de config en `userData` en vez de `.env`.
