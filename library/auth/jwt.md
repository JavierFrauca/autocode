# Autenticación con JWT (JSON Web Tokens)

> ⚠️ **COHERENCIA.** Las apps WEB del andamiaje (`templates/server-app`) NO usan JWT: usan **cookie de sesión
> firmada** (`src/auth/tokens.ts`, HMAC con `node:crypto`) — ver `library/auth/login-system.md`. Este doc aplica
> sobre todo al 4º tipo de app **"api"** (servicio sin pantallas, clientes externos) o a integraciones móviles;
> para una app web con login de usuario, usa la cookie de sesión del andamiaje, no JWT.

**Categoría:** auth | **Cuándo usar:** APIs REST con clientes móviles o web sin estado de sesión servidor

## Concepto
JWT es un token firmado (no cifrado) que el servidor emite y el cliente envía en cada petición.
Estructura: `header.payload.signature` en Base64URL.

## Implementación en Fastify + Node.js

```typescript
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET!;
const EXPIRES = "7d";

export function signToken(payload: { userId: string; role: string }): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token: string): { userId: string; role: string } {
  return jwt.verify(token, SECRET) as any;
}

// Middleware Fastify
export async function jwtMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ error: "No autenticado" });
  try {
    req.user = verifyToken(auth.slice(7));
  } catch {
    return reply.code(401).send({ error: "Token inválido o expirado" });
  }
}
```

## Dependencias
```
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

## Flujo
1. POST /auth/login → valida credenciales → devuelve `{ token, user }`
2. Cliente guarda token en localStorage o cookie httpOnly
3. Cada petición protegida: `Authorization: Bearer <token>`
4. Middleware verifica y adjunta `req.user`

## Consideraciones
- No guardar datos sensibles en el payload (es legible sin la firma)
- Refresh tokens: emitir un token de larga duración para renovar el de acceso
- Para invalidación inmediata: mantener una lista negra en Redis
