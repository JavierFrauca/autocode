# Manejo de errores HTTP global

**Categoría:** arquitectura | **Cuándo usar:** toda API. Un único punto traduce errores a respuestas HTTP coherentes; las rutas no repiten try/catch.

## Idea
El dominio devuelve `Result` o lanza `DomainError` (ver `library/arquitectura/result-type`). El **error handler global** de Fastify captura lo que se escape y lo traduce a un JSON uniforme `{ error, code }`:
- Las rutas quedan limpias (sin try/catch repetido en cada una).
- El cliente recibe SIEMPRE el mismo formato de error.
- Los errores inesperados NO filtran stack traces al usuario.

## Errores de dominio tipados
```typescript
// src/domain/errors/DomainError.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DOMAIN_ERROR",
    public readonly status: number = 422,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entidad: string) {
    super(`${entidad} no encontrado`, "NOT_FOUND", 404);
  }
}
```

## Handler global (Fastify)
```typescript
// src/adapters/http/error-handler.ts
import type { FastifyInstance } from "fastify";
import { DomainError } from "../../domain/errors/DomainError.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    // Validación (Fastify/Zod) → 400
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: "Datos inválidos", code: "VALIDATION" });
    }
    // Negocio → su propio status
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    // Inesperado → 500: se LOGUEA entero, al cliente solo un mensaje genérico.
    req.log.error(err);
    return reply.code(500).send({ error: "Error interno", code: "INTERNAL" });
  });
}
```

## Registro (en server.ts)
```typescript
import { registerErrorHandler } from "./adapters/http/error-handler.js";

registerErrorHandler(app);
```

## Reglas
- **Nunca** devuelvas el `stack` ni el mensaje crudo de un error inesperado al cliente (fuga de información). Lóguealo y responde genérico.
- Mapea cada familia a su status: validación 400, no encontrado 404, negocio 422, permisos 403, inesperado 500.
- Combínalo con `Result` en los handlers (errores esperados) y reserva las excepciones para lo verdaderamente inesperado.
