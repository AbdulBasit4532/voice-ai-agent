import { buildApp, createContext } from "./app.js";
import { config } from "./config.js";

async function main(): Promise<void> {
  const ctx = createContext(config);
  const app = await buildApp(ctx);

  const shutdown = async (signal: string) => {
    ctx.log.info({ signal }, "shutting down");
    await app.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
  ctx.log.info(
    {
      port: config.PORT,
      database: config.DATABASE_PATH,
      public_base_url: config.PUBLIC_BASE_URL ?? "(not set — Vapi webhooks will not reach this server)",
      vapi_webhook: `${config.PUBLIC_BASE_URL ?? `http://localhost:${config.PORT}`}/voice/vapi/webhook`,
    },
    "patient registration service ready",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
