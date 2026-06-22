import alchemy from "alchemy";
import { Vite } from "alchemy/cloudflare";
import { Worker } from "alchemy/cloudflare";
import { D1Database } from "alchemy/cloudflare";
import { Queue } from "alchemy/cloudflare";
import { config } from "dotenv";

// The pipeline queue message shape, for binding-type inference only. The
// canonical, validated definition lives in `@paperlens/orchestrator/queue`
// (`PipelineMessage`); it is duplicated here (not imported) because importing
// the orchestrator into infra would form a dependency cycle through
// `@paperlens/env` (env.d.ts imports this file). Keep the two in sync.
type PipelineMessage =
  | { type: "discover"; runId: string; arxiv_id?: undefined }
  | { type: "digest"; arxiv_id: string; runId: string }
  | { type: "style"; arxiv_id: string; runId: string }
  | { type: "publish"; arxiv_id: string; runId: string };

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const app = await alchemy("paperlens");

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
});

// The pipeline Queue (ADR-001): one message per (paper, stage). The server
// Worker binds it as a producer (PIPELINE_QUEUE) and consumes it via the
// `queue()` handler. A single queue dispatched by `type` (per tech-spec §4.3);
// per-stage queues are a later binding-config change, not needed for the MVP.
const pipelineQueue = await Queue<PipelineMessage>("pipeline");

export const web = await Vite("web", {
  cwd: "../../apps/web",
  assets: "dist",
  bindings: {
    VITE_SERVER_URL: alchemy.env.VITE_SERVER_URL!,
  },
});

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  bindings: {
    DB: db,
    // Producer: the orchestrator sends pipeline messages through this binding.
    PIPELINE_QUEUE: pipelineQueue,
    CORS_ORIGIN: alchemy.env.CORS_ORIGIN!,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: alchemy.env.BETTER_AUTH_URL!,
    OPENROUTER_BASE_URL: alchemy.env.OPENROUTER_BASE_URL!,
    OPENROUTER_API_KEY: alchemy.secret.env.OPENROUTER_API_KEY!,
    OPENROUTER_MODEL_DIGEST: alchemy.env.OPENROUTER_MODEL_DIGEST!,
    OPENROUTER_MODEL_STYLE: alchemy.env.OPENROUTER_MODEL_STYLE!,
  },
  // Consumer: the server's `queue()` handler processes the same queue. After
  // `maxRetries` redeliveries a message is exhausted; the stage handler then
  // marks the Paper `failed` (escalation per failure class is L2, PL-024).
  eventSources: [
    {
      queue: pipelineQueue,
      settings: {
        maxRetries: 3,
      },
    },
  ],
  dev: {
    port: 3000,
  },
});

console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
