# Autenticación con Sesiones y Cookies

**Categoría:** auth | **Cuándo usar:** Aplicaciones web tradicionales, cuando el servidor controla el estado

## Concepto
El servidor mantiene la sesión en memoria/base de datos. El cliente recibe una cookie con el ID de sesión.

## Implementación con Fastify

```typescript
import fastifySession from "@fastify/session";
import fastifyCookie from "@fastify/cookie";

await app.register(fastifyCookie);
await app.register(fastifySession, {
  secret: process.env.SESSION_SECRET!, // mínimo 32 chars
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
  },
  saveUninitialized: false,
});

// Login
app.post("/auth/login", async (req, reply) => {
  const user = await validateCredentials(req.body);
  req.session.userId = user.id;
  req.session.role = user.role;
  return { user };
});

// Logout
app.post("/auth/logout", async (req) => {
  await req.session.destroy();
  return { ok: true };
});

// Middleware protección
async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.userId) return reply.code(401).send({ error: "No autenticado" });
}
```

## Cuándo elegir cookies vs JWT
| Cookies+Sesión | JWT |
|---|---|
| Estado en servidor (fácil de invalidar) | Sin estado (más escalable) |
| Mejor para web tradicional | Mejor para APIs y móvil |
| Vulnerable a CSRF (mitigar con sameSite) | Vulnerable a XSS si en localStorage |
