import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Lógica de autenticación del transporte HTTP, separada de `http.ts` (que arranca un servidor real al
 * importarse) para poder testearla sin abrir puertos. Token compartido vía `Authorization: Bearer
 * <token>` o `X-API-Key`.
 */

/** Comparación en tiempo constante (evita timing attacks). Longitudes distintas → no coincide. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** true si la petición trae el token correcto. Si `expected` es undefined, no hay auth configurada. */
export function isAuthorized(req: Pick<IncomingMessage, "headers">, expected: string | undefined): boolean {
  if (!expected) return true;
  const auth = req.headers.authorization;
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-api-key"] as string | undefined);
  return !!provided && tokensMatch(provided, expected);
}
