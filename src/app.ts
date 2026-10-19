import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import { AppointmentService } from "./appointments/service.js";
import { CallLogRepository } from "./calls/repository.js";
import { type AppConfig } from "./config.js";
import { openDatabase, type Db } from "./db/connection.js";
import { seedIfEmpty } from "./db/seed.js";
import { AppError } from "./lib/errors.js";
import { PatientRepository } from "./patients/repository.js";
import { patientRoutes } from "./patients/routes.js";
import { PatientService } from "./patients/service.js";
import { ToolExecutor } from "./voice/toolExecutor.js";
import { vapiRoutes } from "./voice/vapi/routes.js";

export interface AppContext {
  config: AppConfig;
  db: Db;
  log: Logger;
  patients: PatientService;
  calls: CallLogRepository;
  appointments: AppointmentService;
  tools: ToolExecutor;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "public");

export function createContext(config: AppConfig, log?: Logger): AppContext {
  const logger =
    log ??
    pino({
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
    });
  const db = openDatabase(config.DATABASE_PATH);
  if (config.SEED_ON_BOOT && config.NODE_ENV !== "test") seedIfEmpty(db, logger);

  const patients = new PatientService(new PatientRepository(db), logger);
  const calls = new CallLogRepository(db);
  const appointments = new AppointmentService(db);
  const tools = new ToolExecutor({ patients, calls, appointments, log: logger });
  return { config, db, log: logger, patients, calls, appointments, tools };
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: ctx.log as unknown as FastifyBaseLogger,
    disableRequestLogging: ctx.config.NODE_ENV === "test",
    bodyLimit: 256 * 1024,
  });

  // Handlers must be installed before route plugins register so child contexts inherit them.
  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .send({ data: null, error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` } });
  });

  // Central error -> envelope mapping. Never leaks stack traces to clients.
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({ data: null, error: { code: err.code, message: err.message, ...err.details } });
      return;
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 400 || e.code === "FST_ERR_CTP_INVALID_JSON_BODY" || e.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      reply.code(400).send({ data: null, error: { code: "BAD_REQUEST", message: "Malformed or empty JSON body" } });
      return;
    }
    if (e.statusCode === 413) {
      reply.code(413).send({ data: null, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
      return;
    }
    if (e.statusCode === 415) {
      reply.code(415).send({ data: null, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send application/json" } });
      return;
    }
    req.log.error({ err }, "unhandled error");
    reply.code(500).send({ data: null, error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side" } });
  });

  await app.register(cors, { origin: true });
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: "/dashboard/", decorateReply: false });
  }

  app.get("/", async (_req, reply) => reply.redirect("/dashboard/"));
  app.get("/health", async () => ({
    data: { status: "ok", uptime_s: Math.round(process.uptime()), time: new Date().toISOString() },
    error: null,
  }));

  await app.register(async (api) => patientRoutes(api, ctx));
  await app.register(async (voice) => vapiRoutes(voice, ctx));

  return app;
}
