# Servidor MCP (Model Context Protocol)

Servidor MCP con dos transportes:

- **stdio** (`src/stdio.ts`) — el habitual: lo lanzan clientes como Claude Desktop, Cursor o Claude Code.
- **HTTP** (`src/http.ts`) — para clientes remotos (transporte Streamable HTTP en `POST /mcp`).

La lógica vive en `src/server.ts` (`buildServer()`): ahí se registran las **tools** (acciones que el LLM
puede invocar) y los **resources** (datos que puede leer). Los transportes solo conectan ese servidor a un
canal.

## Uso

```bash
npm install
npm run build          # compila a dist/
npm start              # arranca el servidor por stdio
npm run start:http     # arranca el servidor HTTP (PORT=3000 por defecto)
npm run dev            # stdio en desarrollo (tsx)
```

## Registrar en Claude Desktop (stdio)

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mi-servidor": { "command": "node", "args": ["RUTA_ABSOLUTA/dist/stdio.js"] }
  }
}
```

## Añadir tools

En `src/server.ts`, dentro de `buildServer()`:

```ts
server.registerTool(
  "mi_tool",
  { description: "Qué hace", inputSchema: { campo: z.string().describe("…") } },
  async ({ campo }) => asText({ ok: true, campo })
);
```

- Cada tool devuelve `{ content: [{ type: "text", text }] }` (usa `asText`); errores con `isError: true`.
- Valida la entrada con Zod (`inputSchema`).
- **stdio**: NUNCA escribas a `stdout` (rompe el protocolo) — los logs van a `stderr` (`console.error`).
