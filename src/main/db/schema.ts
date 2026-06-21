import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(datetime('now'))`;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  description: text("description"),
  qdrantCollection: text("qdrant_collection").notNull(),
  embeddingsDim: integer("embeddings_dim").notNull(),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
  deletedAt: text("deleted_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => ({
  projectIdx: index("sessions_project_idx").on(t.projectId),
}));

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull().default(now),
}, (t) => ({
  sessionIdx: index("messages_session_idx").on(t.sessionId),
  projectIdx: index("messages_project_idx").on(t.projectId),
}));

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  path: text("path").notNull(),
  title: text("title").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
  deletedAt: text("deleted_at"),
}, (t) => ({
  pathUniq: uniqueIndex("documents_project_path_uniq").on(t.projectId, t.path),
  projectIdx: index("documents_project_idx").on(t.projectId),
}));

export const documentRevisions = sqliteTable("document_revisions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  body: text("body").notNull(),
  authorRole: text("author_role").notNull(),
  agentRunId: text("agent_run_id"),
  sourceMessageId: text("source_message_id"),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(now),
}, (t) => ({
  documentIdx: index("revisions_document_idx").on(t.documentId),
  projectIdx: index("revisions_project_idx").on(t.projectId),
}));

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  sessionId: text("session_id").references(() => sessions.id),
  agentType: text("agent_type").notNull(),
  triggeredBy: text("triggered_by").notNull(),
  triggerRunId: text("trigger_run_id"),
  modelRole: text("model_role"),
  modelName: text("model_name"),
  input: text("input", { mode: "json" }),
  output: text("output", { mode: "json" }),
  status: text("status").notNull().default("pending"),
  errorKind: text("error_kind"),
  errorMessage: text("error_message"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(now),
  finishedAt: text("finished_at"),
}, (t) => ({
  projectIdx: index("agent_runs_project_idx").on(t.projectId),
  statusIdx: index("agent_runs_status_idx").on(t.status),
}));

export const embeddingsIndex = sqliteTable("embeddings_index", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  revisionId: text("revision_id").notNull().references(() => documentRevisions.id),
  chunkIndex: integer("chunk_index").notNull(),
  qdrantPointId: text("qdrant_point_id").notNull(),
  createdAt: text("created_at").notNull().default(now),
}, (t) => ({
  projectIdx: index("eix_project_idx").on(t.projectId),
  revisionIdx: index("eix_revision_idx").on(t.revisionId),
}));

export const appConfig = sqliteTable("app_config", {
  id: text("id").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

export const sprintPlans = sqliteTable("sprint_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  planJson: text("plan_json", { mode: "json" }).notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
}, (t) => ({
  projectIdx: index("sprint_plans_project_idx").on(t.projectId),
}));

export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  status: text("status").notNull().default("running"),
  currentPhase: text("current_phase"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(now),
  finishedAt: text("finished_at"),
}, (t) => ({
  projectIdx: index("executions_project_idx").on(t.projectId),
}));

export const executionSteps = sqliteTable("execution_steps", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executions.id),
  phase: text("phase").notNull(),
  label: text("label").notNull(),
  detail: text("detail"),
  status: text("status").notNull().default("pending"),
  ord: integer("ord").notNull(),
  createdAt: text("created_at").notNull().default(now),
  finishedAt: text("finished_at"),
}, (t) => ({
  execIdx: index("execution_steps_exec_idx").on(t.executionId),
}));
