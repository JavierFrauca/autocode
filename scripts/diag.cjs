/* Diagnóstico read-only: último estado real de generación en la BD. Correr bajo Electron. */
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");
const dbPath = process.env.AUTOCODE_DB_PATH || path.join(os.homedir(), "AppData", "Roaming", "autocode", "autocode.db");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

function q(sql, ...a) { try { return db.prepare(sql).all(...a); } catch (e) { return [{ error: String(e.message) }]; } }

console.log("=== PROJECTS ===");
for (const p of q("SELECT id,name,root_path,qdrant_collection FROM projects WHERE deleted_at IS NULL")) {
  console.log(` ${p.name}  id=${p.id}\n   root=${p.root_path}`);
}

console.log("\n=== SPRINT_PLANS (count por proyecto) ===");
console.log(q("SELECT project_id, COUNT(*) n FROM sprint_plans GROUP BY project_id"));

console.log("\n=== ÚLTIMAS 5 EXECUTIONS ===");
const execs = q("SELECT id,project_id,status,current_phase,error,created_at,finished_at FROM executions ORDER BY created_at DESC LIMIT 5");
for (const e of execs) {
  console.log(` exec=${e.id} status=${e.status} phase=${e.current_phase} created=${e.created_at}`);
  if (e.error) console.log(`   error: ${String(e.error).slice(0, 300)}`);
}

if (execs[0] && !execs[0].error) {
  console.log("\n=== STEPS DE LA ÚLTIMA EXECUTION ===");
  for (const s of q("SELECT phase,label,status,detail FROM execution_steps WHERE execution_id=? ORDER BY ord", execs[0].id)) {
    console.log(` [${s.status}] ${s.phase} · ${s.label}${s.detail ? "  — " + String(s.detail).replace(/\n/g, " ").slice(0, 160) : ""}`);
  }
}

console.log("\n=== ÚLTIMOS 8 AGENT_RUNS ===");
for (const r of q("SELECT agent_type,status,error_kind,error_message,created_at FROM agent_runs ORDER BY created_at DESC LIMIT 8")) {
  console.log(` ${r.agent_type} ${r.status}${r.error_kind ? " ["+r.error_kind+"]" : ""}${r.error_message ? " — "+String(r.error_message).slice(0,140) : ""}`);
}
db.close();
