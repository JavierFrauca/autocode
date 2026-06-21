# Logging estructurado (Pino + Fastify)

**Categoría:** integraciones | **Cuándo usar:** toda app servidor. Fastify trae Pino integrado: úsalo en vez de `console.log`.

## Por qué
`console.log` se pierde y no es buscable. El logging estructurado (JSON con niveles) permite filtrar, correlacionar por request y diagnosticar en producción sin adivinar.

## Activar el logger de Fastify
```typescript
import Fastify from "fastify";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    // Desarrollo: salida legible. Producción: JSON crudo (más rápido y parseable).
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
  },
});
```

## Usar el logger por request
```typescript
app.post("/api/pedidos", async (req, reply) => {
  req.log.info({ clienteId: (req.body as { clienteId?: string }).clienteId }, "creando pedido");
  // ... lógica
  return reply.code(201).send({ ok: true });
});
```

## Niveles
| Nivel | Cuándo |
|---|---|
| `error` | algo falló y requiere atención (lleva el objeto Error con stack) |
| `warn` | anomalía recuperable (reintento, stock bajo) |
| `info` | hitos del negocio (pedido creado, login) |
| `debug` | detalle para diagnosticar (apagado en producción) |

## Reglas de oro
- **Nunca loguees secretos** ni datos personales sensibles (contraseñas, tokens, tarjetas). Filtra u omite esos campos.
- Loguea **objetos**, no concatenes strings: `req.log.info({ id }, "guardado")`, no `"guardado " + id`.
- Un `error` siempre con el objeto Error: `req.log.error(err)` (incluye el stack).
- En desarrollo añade `pino-pretty` (devDependency); en producción deja el JSON.
- Combínalo con el handler global (`library/arquitectura/manejo-errores`): los 500 se loguean enteros ahí.
