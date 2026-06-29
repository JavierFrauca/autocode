import type { FastifyInstance } from "fastify";
import { ARCH_TEMPLATE, deriveAppType, ensureArchitecture, getArchitecture } from "../architecture.js";
import { getProjectScope } from "../agents/scope.js";

/**
 * ADR de arquitectura: fuente de verdad del stack/topología. Lo elicita el chat (lo escribe
 * el documenter) y se ve/edita en Documentos como un paper más — no hay pestaña propia para
 * no confundir a usuarios no técnicos con la palabra "arquitectura". El planner deriva de aquí.
 */
export async function registerArchitectureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:id/architecture", async (req) => {
    const { id } = req.params as { id: string };
    const arch = await getArchitecture(id);
    if (arch) return { exists: true, body: arch.body, appType: arch.appType, isDefault: arch.isDefault };
    return { exists: false, body: ARCH_TEMPLATE, appType: deriveAppType(ARCH_TEMPLATE), isDefault: true };
  });

  // Crea el ADR por defecto si aún no existe (lo usa "Generar app"). Idempotente.
  app.post("/api/projects/:id/architecture/ensure", async (req) => {
    const { id } = req.params as { id: string };
    const arch = await ensureArchitecture(id);
    return { exists: true, body: arch.body, appType: arch.appType, isDefault: arch.isDefault };
  });

  // Cobertura del alcance (motor de completitud): qué piezas faltan y el progreso. Lo consume el
  // indicador del chat para que el usuario vea cuánto le queda por definir.
  app.get("/api/projects/:id/scope", async (req) => {
    const { id } = req.params as { id: string };
    return getProjectScope(id);
  });
}
