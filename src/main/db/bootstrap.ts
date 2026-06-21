import { ensureDbDir, rawSqlite } from "./client.js";

const SCHEMA_SQL = `
create table if not exists projects (
  id text primary key,
  name text not null,
  root_path text not null,
  description text,
  qdrant_collection text not null,
  embeddings_dim integer not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  deleted_at text
);

create table if not exists sessions (
  id text primary key,
  project_id text not null references projects(id),
  title text,
  created_at text not null default (datetime('now'))
);
create index if not exists sessions_project_idx on sessions(project_id);

create table if not exists messages (
  id text primary key,
  project_id text not null references projects(id),
  session_id text not null references sessions(id),
  role text not null,
  content text not null,
  metadata text,
  created_at text not null default (datetime('now'))
);
create index if not exists messages_session_idx on messages(session_id);
create index if not exists messages_project_idx on messages(project_id);

create table if not exists documents (
  id text primary key,
  project_id text not null references projects(id),
  path text not null,
  title text not null,
  tags text not null default '[]',
  status text not null default 'active',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  deleted_at text
);
create unique index if not exists documents_project_path_uniq on documents(project_id, path);
create index if not exists documents_project_idx on documents(project_id);

create table if not exists document_revisions (
  id text primary key,
  document_id text not null references documents(id),
  project_id text not null references projects(id),
  body text not null,
  author_role text not null,
  agent_run_id text,
  source_message_id text,
  comment text,
  created_at text not null default (datetime('now'))
);
create index if not exists revisions_document_idx on document_revisions(document_id);
create index if not exists revisions_project_idx on document_revisions(project_id);

create table if not exists agent_runs (
  id text primary key,
  project_id text not null references projects(id),
  session_id text references sessions(id),
  agent_type text not null,
  triggered_by text not null,
  trigger_run_id text,
  model_role text,
  model_name text,
  input text,
  output text,
  status text not null default 'pending',
  error_kind text,
  error_message text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  duration_ms integer,
  created_at text not null default (datetime('now')),
  finished_at text
);
create index if not exists agent_runs_project_idx on agent_runs(project_id);
create index if not exists agent_runs_status_idx on agent_runs(status);

create table if not exists embeddings_index (
  id text primary key,
  project_id text not null references projects(id),
  document_id text not null references documents(id),
  revision_id text not null references document_revisions(id),
  chunk_index integer not null,
  qdrant_point_id text not null,
  created_at text not null default (datetime('now'))
);
create index if not exists eix_project_idx on embeddings_index(project_id);
create index if not exists eix_revision_idx on embeddings_index(revision_id);

create table if not exists app_config (
  id text primary key,
  value text not null,
  updated_at text not null default (datetime('now'))
);

create table if not exists sprint_plans (
  id text primary key,
  project_id text not null references projects(id),
  plan_json text not null,
  status text not null default 'draft',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
create index if not exists sprint_plans_project_idx on sprint_plans(project_id);

create table if not exists executions (
  id text primary key,
  project_id text not null references projects(id),
  status text not null default 'running',
  current_phase text,
  error text,
  created_at text not null default (datetime('now')),
  finished_at text
);
create index if not exists executions_project_idx on executions(project_id);

create table if not exists execution_steps (
  id text primary key,
  execution_id text not null references executions(id),
  phase text not null,
  label text not null,
  detail text,
  status text not null default 'pending',
  ord integer not null,
  created_at text not null default (datetime('now')),
  finished_at text
);
create index if not exists execution_steps_exec_idx on execution_steps(execution_id);
`;

export async function ensureSchema(): Promise<void> {
  await ensureDbDir();
  const db = rawSqlite();
  db.exec(SCHEMA_SQL);

  // Cancel any agent runs stuck in 'running' state from a previous crash
  db.exec(`UPDATE agent_runs SET status = 'cancelled', finished_at = datetime('now')
           WHERE status IN ('running', 'pending') AND agent_type IN ('searcher', 'patternCurator')`);
}
