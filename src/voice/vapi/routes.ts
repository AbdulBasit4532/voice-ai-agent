import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../../app.js";
import type { ToolCall } from "../toolExecutor.js";

/**
 * Vapi "server URL" webhook. Vapi POSTs { message: {...} } for every event we subscribed to
 * in the assistant config. We only need to answer `tool-calls`; the others are observability.
 *
 * Shape reference (abridged):
 *   tool-calls:          { type, call, toolCallList: [{ id, name?, arguments?, function?: { name, arguments } }] }
 *   end-of-call-report:  { type, call, endedReason, summary, transcript, artifact: { transcript, messages } }
 *   status-update:       { type, call, status: "in-progress" | "ended" | ..., endedReason? }
 *   hang:                { type, call }  (model took too long to respond)
 */
export async function vapiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { calls, tools, log, config } = ctx;

  const authorized = (req: FastifyRequest): boolean => {
    const header = req.headers["x-vapi-secret"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(config.VAPI_SERVER_SECRET);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  /**
   * Browser "web call" configuration for the dashboard. Only the PUBLIC key is exposed
   * (it is designed for client-side use); the private key never leaves the server.
   */
  app.get("/voice/vapi/web-config", async () => {
    const enabled = Boolean(config.VAPI_PUBLIC_KEY && config.VAPI_ASSISTANT_ID);
    return {
      data: enabled
        ? { enabled, publicKey: config.VAPI_PUBLIC_KEY, assistantId: config.VAPI_ASSISTANT_ID }
        : { enabled, reason: "Set VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID to enable browser calls." },
      error: null,
    };
  });

  app.post("/voice/vapi/webhook", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorized(req)) {
      log.warn({ ip: req.ip }, "vapi webhook rejected: bad secret");
      return reply.code(401).send({ data: null, error: { code: "UNAUTHORIZED", message: "invalid webhook secret" } });
    }

    const body = (req.body ?? {}) as { message?: Record<string, unknown> };
    const message = body.message ?? {};
    const type = String(message.type ?? "");
    const call = (message.call ?? {}) as Record<string, unknown>;
    const callId = String(call.id ?? message.callId ?? `unknown-${Date.now()}`);
    const customer = (call.customer ?? message.customer ?? {}) as { number?: string };
    const callerNumber = customer.number ?? null;

    switch (type) {
      case "tool-calls": {
        const toolCalls = normaliseToolCalls(message.toolCallList);
        calls.ensure(callId, "vapi", callerNumber);
        const results = [];
        for (const tc of toolCalls) {
          const r = await tools.execute(tc, { callId, callerNumber, provider: "vapi" });
          results.push({ toolCallId: r.id, name: r.name, result: JSON.stringify(r.result) });
        }
        return { results };
      }

      case "status-update": {
        const status = String(message.status ?? "");
        calls.ensure(callId, "vapi", callerNumber);
        if (status === "ended") {
          const endedReason = String(message.endedReason ?? "");
          const existing = calls.get(callId);
          const dropped = /error|pipeline|failed|silence|no-answer|twilio|sip|exceeded/i.test(endedReason);
          calls.update(callId, {
            status: dropped ? "dropped" : "completed",
            ended_reason: endedReason || null,
            ended_at: new Date().toISOString(),
            outcome: existing?.outcome ?? (dropped ? "dropped" : "abandoned"),
          });
          log.info({ event: "call.ended", call_id: callId, endedReason, outcome: existing?.outcome }, "call ended");
        } else {
          log.info({ event: "call.status", call_id: callId, status }, "call status update");
        }
        return { ok: true };
      }

      case "end-of-call-report": {
        const artifact = (message.artifact ?? {}) as { transcript?: string; messages?: unknown[] };
        const transcript = (message.transcript as string | undefined) ?? artifact.transcript ?? null;
        const summary = (message.summary as string | undefined) ?? null;
        const endedReason = String(message.endedReason ?? "");
        calls.ensure(callId, "vapi", callerNumber);
        const existing = calls.get(callId);
        calls.update(callId, {
          status: existing?.status === "in-progress" ? "completed" : existing?.status,
          transcript,
          summary,
          ended_reason: endedReason || existing?.ended_reason || null,
          ended_at: existing?.ended_at ?? new Date().toISOString(),
          outcome: existing?.outcome ?? "abandoned",
        });
        // Observability: the full conversation goes to stdout as well as the database.
        log.info(
          { event: "call.transcript", call_id: callId, patient_id: existing?.patient_id ?? null, summary, transcript },
          "end of call report",
        );
        return { ok: true };
      }

      case "hang": {
        log.warn({ event: "call.hang", call_id: callId }, "vapi reported model hang");
        return { ok: true };
      }

      case "assistant-request": {
        // Only used if a number is attached without an assistant; return the same config.
        const { buildAssistantConfig } = await import("./assistant.js");
        if (!config.PUBLIC_BASE_URL) return { error: "PUBLIC_BASE_URL not configured" };
        return { assistant: buildAssistantConfig({ publicBaseUrl: config.PUBLIC_BASE_URL, serverSecret: config.VAPI_SERVER_SECRET }) };
      }

      default:
        log.debug({ type, call_id: callId }, "ignored vapi message");
        return { ok: true };
    }
  });
}

/** Accepts both the legacy flat shape and the OpenAI-style nested `function` shape. */
export function normaliseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const r = item as Record<string, unknown>;
    const fn = (r.function ?? {}) as Record<string, unknown>;
    const name = String(r.name ?? fn.name ?? "");
    let args = r.arguments ?? fn.arguments ?? r.parameters ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { id: String(r.id ?? `tc_${i}`), name, arguments: (args ?? {}) as Record<string, unknown> };
  });
}
