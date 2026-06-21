# Template: Error handler global + DomainError

**tags:** fastify, errores, error-handler, domain-error
**transversal:** true

Dos ficheros. Registra el handler en `server.ts` justo tras crear la instancia (`registerErrorHandler(app)`).

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
```

```typescript
// src/adapters/http/error-handler.ts
import type { FastifyInstance } from "fastify";
import { DomainError } from "../../domain/errors/DomainError.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: "Datos inválidos", code: "VALIDATION" });
    }
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "Error interno", code: "INTERNAL" });
  });
}
```
