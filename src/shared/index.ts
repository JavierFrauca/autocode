export type ModelRole = "chat" | "code" | "embeddings" | "cheap" | "docs";

/**
 * Tipo de aplicación que AutoCode sabe generar:
 *  - "electron": app de ESCRITORIO (Electron + Vue, SQLite local).
 *  - "server":   app CLIENTE-SERVIDOR / web (Fastify + Vue + SQLite/Postgres). Lleva login + auditoría.
 *  - "mcp":      servidor MCP (Model Context Protocol) con transporte stdio y/o HTTP.
 *  - "api":      servicio API / integración SIN interfaz (Fastify + SQLite), autenticado por API key,
 *                con auditoría y tareas programadas. Lo consumen otros sistemas (webhooks, sync).
 */
export type AppType = "electron" | "server" | "mcp" | "api";

/**
 * Proveedores de generación que AutoCode sabe conectar directamente (sin LiteLLM obligatoria).
 * Todos hablan el dialecto OpenAI-compatible; `local` es el preset avanzado (Ollama/LM Studio/LiteLLM).
 */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "groq"
  | "openrouter"
  | "local";

/**
 * Configuración de generación elegida por el usuario. Dos modos: `cloud` (proveedor + API key) o
 * `local` (su propia URL OpenAI-compatible). Un único proveedor sirve TODA la generación; por
 * dentro AutoCode mapea los 5 roles a estos 2 modelos (ver `modelFor` en llm/client.ts).
 */
export interface GenerationConfig {
  mode: "cloud" | "local";
  provider: ProviderId;
  /** cloud: derivado del preset (ignora lo que venga); local: lo escribe el usuario. */
  baseUrl: string;
  apiKey: string;
  /** Modelo potente: alimenta los roles chat, code y docs. */
  mainModel: string;
  /** Modelo barato/rápido: alimenta el rol cheap (títulos, clasificación). */
  fastModel: string;
}

/**
 * Embeddings: ya NO los configura el usuario. Van SIEMPRE locales en proceso (bge-m3 vía ONNX),
 * con dimensión fija → las colecciones Qdrant existentes siguen siendo válidas sin reindexar.
 */
export const EMBEDDINGS_MODEL = "bge-m3";
export const EMBEDDINGS_DIM = 1024;

/**
 * Estado de una entrada del catálogo CERRADO de MCPs (ver `src/main/mcp/catalog.ts`): el catálogo en sí
 * NO lo edita el usuario (son entradas curadas por AutoCode, con sus ventajas/inconvenientes explicados
 * en la ficha) — esto solo guarda si el usuario la activó y los valores que rellenó (p.ej. una clave)
 * para las que la necesiten.
 */
export interface McpServerConfig {
  /** Coincide con el `id` de una entrada de `MCP_CATALOG`. */
  id: string;
  activo: boolean;
  /** Valores que el usuario ha rellenado para las variables que la entrada declara en `envRequerido`. */
  env?: Record<string, string>;
}

export interface AppConfig {
  generation: GenerationConfig;
  projectsRoot: string;
  qdrantUrl: string;
  advanced?: {
    promptEditor?: boolean;
    docHistory?: boolean;
  };
  mcpServers?: McpServerConfig[];
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Session {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  sessionId: string;
  projectId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type DocumentStatus = "draft" | "active" | "deprecated";

export interface DocumentRecord {
  id: string;
  projectId: string;
  path: string;
  title: string;
  tags: string[];
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export type AgentType = "documenter" | "planner" | "coder" | "qa" | "executor" | "reindexer" | "reconciler" | "packager";

export type AgentStatus =
  | "pending"
  | "running"
  | "done"
  | "applied"
  | "discarded"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  projectId: string;
  sessionId: string | null;
  agentType: AgentType;
  triggeredBy: "user" | "system" | "agent";
  triggerRunId: string | null;
  modelRole: ModelRole | null;
  modelName: string | null;
  input: any;
  output: any;
  status: AgentStatus;
  errorKind: string | null;
  errorMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SearchHit {
  documentId: string;
  revisionId: string;
  path: string;
  title: string;
  headingPath: string | null;
  chunkText: string;
  score: number;
  projectId: string;
}
