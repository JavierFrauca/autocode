import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AppConfig } from "@shared";
import type { ChatTool } from "../llm/client.js";
import { getCatalogEntry, type McpCatalogEntry } from "./catalog.js";
import { log } from "../log.js";

/**
 * Cliente MCP genérico del motor de chat: conecta con los servidores de la biblioteca cerrada
 * (`catalog.ts`) que el usuario tenga activos, descubre sus tools y las envuelve como `ChatTool` para
 * que se sumen a `chatTools` en `routes/chat.ts` — el mismo mecanismo sirve igual para un MCP de
 * terceros validado que para uno propio de AutoCode el día de mañana; no hay nada específico de
 * "búsqueda" aquí a propósito.
 */

interface ActiveConnection {
  client: Client;
  tools: ChatTool[];
}

// Conexiones vivas por id de catálogo — evita relanzar el proceso en cada turno de chat.
const active = new Map<string, ActiveConnection>();
// Entradas que ya fallaron esta sesión de la app: no se reintenta en cada mensaje (solo con resetMcpFailure).
const failed = new Set<string>();

// La primera activación de un MCP basado en `npx` puede tardar (descarga el paquete de npm si no está
// cacheado ya) — generoso a propósito para no marcar como "fallo" algo que solo estaba tardando.
const CONNECT_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout tras ${ms / 1000}s (${label})`)), ms)),
  ]);
}

/** Prefijo por servidor para que el modelo nunca confunda tools de MCPs distintos (o con las propias de AutoCode). */
function prefixedName(entryId: string, toolName: string): string {
  return `${entryId.replace(/-/g, "_")}__${toolName}`;
}

function toolResultToText(r: unknown): string {
  const content = (r as { content?: unknown })?.content;
  const parts = Array.isArray(content) ? content : [];
  const texto = parts
    .filter((c: any): c is { type: "text"; text: string } => c?.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();
  return texto || "(sin contenido)";
}

/**
 * Conecta con UNA entrada del catálogo y envuelve sus tools. Exportada aparte de `getActiveMcpTools`
 * para poder testear el mecanismo de conexión (spawn + listTools + wrap) contra un MCP de prueba, sin
 * depender de que el catálogo real tenga alguna entrada en estado "disponible" todavía.
 */
export async function connectEntry(entry: McpCatalogEntry, env: Record<string, string>): Promise<ActiveConnection> {
  // Si la entrada va vendida (node_modules), resuelve la ruta real (dev/empaquetado) aquí — el usuario
  // no necesita Node/npm instalados. Sin resolveCommand, se usa command/args tal cual (p.ej. el extractor
  // interno, que ya resuelve su propia ruta antes de llamar a connectEntry).
  const resolved = entry.resolveCommand?.() ?? { command: entry.command, args: entry.args };
  const client = new Client({ name: "autocode-chat", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: resolved.command,
    args: resolved.args,
    // Orden: por defecto seguro del SO < fijo del catálogo (decide AutoCode) < del usuario (una clave, si aplica).
    env: { ...getDefaultEnvironment(), ...entry.envFijo, ...env },
  });
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `conectar con ${entry.nombre}`);
  } catch (e) {
    await client.close().catch(() => {}); // si el timeout gana la carrera, no dejar el proceso hijo huérfano
    throw e;
  }

  let tools: Awaited<ReturnType<typeof client.listTools>>["tools"];
  try {
    ({ tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `listar tools de ${entry.nombre}`));
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
  const wrapped: ChatTool[] = tools.map((t) => ({
    name: prefixedName(entry.id, t.name),
    description: `[${entry.nombre}] ${t.description ?? t.name}`,
    parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    run: async (args: any): Promise<string> => {
      try {
        const r = await client.callTool({ name: t.name, arguments: args });
        const texto = toolResultToText(r);
        return r.isError ? `Error de ${entry.nombre}: ${texto}` : texto;
      } catch (e: any) {
        log.warn("mcp", "fallo llamando a una tool del MCP", { err: e, entry: entry.id, tool: t.name });
        return `${entry.nombre} no respondió. Puede que esté caído o mal configurado; el usuario no tiene que hacer nada, ya se ha registrado el problema.`;
      }
    },
  }));
  return { client, tools: wrapped };
}

/**
 * Tools de todos los MCP de la biblioteca que el usuario tiene ACTIVOS. El gate real vive aquí (no solo
 * en la UI de Ajustes): nunca conecta una entrada cuyo estado en el catálogo no sea "disponible", pase
 * lo que pase en la configuración guardada — así una entrada `pendiente_de_validar` es imposible de
 * activar aunque alguien manipule la BD a mano. Best-effort: si un MCP falla al conectar o al listar sus
 * tools, se registra el fallo y el turno de chat sigue igual sin sus tools.
 */
export async function getActiveMcpTools(cfg: AppConfig): Promise<ChatTool[]> {
  const configurados = cfg.mcpServers ?? [];
  const out: ChatTool[] = [];

  for (const servidor of configurados) {
    if (!servidor.activo || failed.has(servidor.id)) continue;
    const entry = getCatalogEntry(servidor.id);
    if (!entry || entry.estado !== "disponible") continue;

    let conn = active.get(entry.id);
    if (!conn) {
      try {
        conn = await connectEntry(entry, servidor.env ?? {});
        active.set(entry.id, conn);
      } catch (e) {
        failed.add(entry.id);
        log.warn("mcp", "no se pudo conectar con el servidor MCP", { err: e, id: entry.id });
        continue;
      }
    }
    out.push(...conn.tools);
  }
  return out;
}

/** Cierra todas las conexiones activas (al cerrar la app). */
export async function closeAllMcpConnections(): Promise<void> {
  for (const conn of active.values()) {
    await conn.client.close().catch(() => {});
  }
  active.clear();
  failed.clear();
}

/** Olvida un fallo previo (p.ej. tras guardar en Ajustes una nueva clave para un MCP que antes falló). */
export function resetMcpConnection(id: string): void {
  failed.delete(id);
  const conn = active.get(id);
  if (conn) {
    conn.client.close().catch(() => {});
    active.delete(id);
  }
}
