import type { AppType } from "@shared";

/**
 * Derivación del tipo de app a partir del cuerpo del ADR de arquitectura. Puro (sin BD),
 * para poder testearlo aislado.
 */
export function deriveAppType(body: string): AppType {
  const m =
    body.match(/\*\*\s*tipo\s*(?:de aplicaci[oó]n)?\s*:\s*\*\*\s*([^\n]+)/i) ??
    body.match(/^\s*[-*]?\s*tipo\s*(?:de aplicaci[oó]n)?\s*:\s*([^\n]+)/im);
  const hint = (m?.[1] ?? body).toLowerCase();
  // MCP primero: "servidor MCP" contiene "servidor", que si no se comprobaría como server.
  if (/\bmcp\b|model context protocol/.test(hint)) return "mcp";
  // API/integración antes que server: un "servicio API" o "de integración" es server pero SIN interfaz.
  if (/\bapi\b|webhook|integraci[oó]n|microservicio|sin (interfaz|pantalla|front)|solo backend/.test(hint)) return "api";
  if (/\b(escritorio|electron|desktop|instalad)/.test(hint)) return "electron";
  if (/\b(web|servidor|server|navegador|varios usuarios|multiusuario|equipo)/.test(hint)) return "server";
  return "server";
}
