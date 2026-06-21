import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token de sesión firmado (HMAC-SHA256), SIN dependencias externas — usa solo `node:crypto`. Va en una
 * cookie httpOnly, así que el navegador lo envía solo y el front nunca lo manipula. NO es cifrado: el
 * contenido es legible (base64url), pero la firma impide falsificarlo. No metas secretos en el payload.
 *
 * El secreto se toma de AUTH_SECRET (lo fija AutoCode al "Probar", y el sysop en producción). En
 * desarrollo cae a un valor por defecto para que la app arranque sin configurar nada.
 */
const SECRET = process.env.AUTH_SECRET ?? "dev-secret-cambia-esto-en-produccion";
const TTL_SEGUNDOS = 60 * 60 * 8; // 8 horas

export interface Sesion {
  sub: string;   // id de usuario
  email: string;
  rol: string;
  exp: number;   // epoch (segundos)
}

export function firmarSesion(datos: Pick<Sesion, "sub" | "email" | "rol">, ttl = TTL_SEGUNDOS): string {
  const payload: Sesion = { ...datos, exp: Math.floor(Date.now() / 1000) + ttl };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const firma = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${firma}`;
}

export function verificarSesion(token: string | undefined | null): Sesion | null {
  if (!token) return null;
  const [body, firma] = token.split(".");
  if (!body || !firma) return null;
  const esperada = createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Sesion;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
