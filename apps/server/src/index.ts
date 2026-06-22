import { env } from "@paperlens/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import { createContext } from "@paperlens/api/context";
import { appRouter } from "@paperlens/api/routers/index";
import { createAuth } from "@paperlens/auth";
import { dispatch, parsePipelineMessage, type PipelineMessage } from "@paperlens/orchestrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

/**
 * Cloudflare Queue consumer (PL-018). A thin router: read each message's `type`
 * and hand it to the orchestrator's `dispatch`, which holds all pipeline logic
 * (loading intermediates, advancing `Paper.status`, enqueuing the next stage)
 * and the resume/idempotency + terminal-failure handling. The orchestrator
 * resolves the real `DB` + `PIPELINE_QUEUE` bindings from its own defaults, so no
 * dependencies are threaded here. An unknown message type is acked without
 * advancing any Paper.
 */
async function queue(batch: MessageBatch<PipelineMessage>): Promise<void> {
  for (const message of batch.messages) {
    const parsed = parsePipelineMessage(message.body);
    if (!parsed) {
      console.error(`queue consumer: rejecting unknown message`, message.body);
      message.ack(); // not a valid pipeline message — drop it, advance nothing
      continue;
    }
    try {
      // `message.attempts` is 1-based; `maxRetries` mirrors the consumer binding
      // (alchemy.run.ts eventSources). On a within-budget throw the Queue
      // redelivers; once exhausted the orchestrator marks the Paper failed.
      await dispatch(parsed, {}, { attempt: message.attempts, maxRetries: 3 });
      message.ack();
    } catch (error) {
      console.error(`queue consumer: ${parsed.type} threw, will retry`, error);
      message.retry();
    }
  }
}

// The server Worker hosts both the `fetch` handler (oRPC + auth, unchanged) and
// the pipeline Queue `queue()` consumer.
export default {
  fetch: app.fetch,
  queue,
};
