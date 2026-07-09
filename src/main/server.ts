import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ensureSchema } from "./db/bootstrap";
import { startBackgroundLoop } from "./agents/runner";
import { registerHealthRoutes } from "./routes/health";
import { registerConfigRoutes } from "./routes/config";
import { registerProjectRoutes } from "./routes/projects";
import { registerSessionRoutes } from "./routes/sessions";
import { registerChatRoutes } from "./routes/chat";
import { registerAgentRoutes } from "./routes/agents";
import { registerFilesRoutes } from "./routes/files";
import { registerPlanRoutes } from "./routes/plan";
import { registerMcpRoutes } from "./routes/mcp";
import { registerMcpCatalogRoutes } from "./routes/mcp-catalog";
import { registerVersionRoutes } from "./routes/versions";
import { registerExecutionRoutes } from "./routes/execution";
import { registerPreviewRoutes } from "./routes/preview";
import { registerArchitectureRoutes } from "./routes/architecture";
import { registerMediaRoutes } from "./routes/media";
import { registerPromptRoutes } from "./routes/prompts";
import { registerAttachRoutes } from "./routes/attach";
import { registerLlmRoutes } from "./routes/llm";
import { registerLibraryRoutes } from "./routes/library";
import { startWatcher } from "./watcher";

export async function startServer(): Promise<void> {
  await ensureSchema();

  const app = Fastify({ logger: { level: "info" } });

  await app.register(cors, {
    origin: (_origin: any, cb: any) => cb(null, true),
    credentials: true,
  });
  await app.register(multipart);

  await registerHealthRoutes(app);
  await registerConfigRoutes(app);
  await registerProjectRoutes(app);
  await registerSessionRoutes(app);
  await registerChatRoutes(app);
  await registerAgentRoutes(app);
  await registerFilesRoutes(app);
  await registerPlanRoutes(app);
  await registerMcpRoutes(app);
  await registerMcpCatalogRoutes(app);
  await registerVersionRoutes(app);
  await registerExecutionRoutes(app);
  await registerPreviewRoutes(app);
  await registerArchitectureRoutes(app);
  await registerMediaRoutes(app);
  await registerPromptRoutes(app);
  await registerAttachRoutes(app);
  await registerLlmRoutes(app);
  await registerLibraryRoutes(app);

  startBackgroundLoop();

  const port = Number(process.env.API_PORT ?? 4317);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  app.log.info("AutoCode API up");

  startWatcher(app.log).catch((e: any) => app.log.warn(e, "watcher failed"));
}
