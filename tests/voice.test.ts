import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/app.js";
import { normaliseToolCalls } from "../src/voice/vapi/routes.js";
import { testApp, VALID_PATIENT } from "./helpers.js";

let app: FastifyInstance;
let ctx: AppContext;
const meta = { callId: "call_test", callerNumber: "+13125550188", provider: "vapi" };

beforeAll(async () => {
  ({ app, ctx } = await testApp());
});
afterAll(async () => {
  await app.close();
});

const json = (res: { body: string }) => JSON.parse(res.body);

describe("ToolExecutor", () => {
  it("validate_field returns a spoken re-prompt for a 3-digit phone number", async () => {
    const r = await ctx.tools.execute({ id: "1", name: "validate_field", arguments: { field: "phone_number", value: "123" } }, meta);
    expect(r.result.ok).toBe(false);
    expect(r.result.say).toMatch(/ten-digit/);
  });

  it("validate_field returns a spoken re-prompt for a future date of birth", async () => {
    const r = await ctx.tools.execute({ id: "1", name: "validate_field", arguments: { field: "date_of_birth", value: "01/01/2099" } }, meta);
    expect(r.result.ok).toBe(false);
    expect(r.result.reason).toMatch(/future/);
    expect(r.result.say).toMatch(/date of birth/);
  });

  it("validate_field normalises valid values", async () => {
    const r = await ctx.tools.execute({ id: "1", name: "validate_field", arguments: { field: "state", value: "Illinois" } }, meta);
    expect(r.result).toEqual({ ok: true, field: "state", value: "IL" });
  });

  it("save_patient persists and links the call log; lookup then detects the duplicate", async () => {
    const saved = await ctx.tools.execute({ id: "1", name: "save_patient", arguments: VALID_PATIENT }, meta);
    expect(saved.result.ok).toBe(true);
    expect(saved.result.action).toBe("created");
    expect(saved.result.say).toMatch(/You're all set, Sarah/);

    const call = ctx.calls.get(meta.callId);
    expect(call?.patient_id).toBe(saved.result.patient_id);
    expect(call?.outcome).toBe("registered");
    expect(JSON.parse(call?.collected_data ?? "{}").last_name).toBe("Davis");

    const lookup = await ctx.tools.execute({ id: "2", name: "lookup_patient_by_phone", arguments: { phone_number: "312-555-0188" } }, meta);
    expect(lookup.result.found).toBe(true);
    expect(lookup.result.say).toBe("It looks like we already have a record for Sarah Davis. Would you like to update your information instead?");

    const none = await ctx.tools.execute({ id: "3", name: "lookup_patient_by_phone", arguments: { phone_number: "2125550000" } }, meta);
    expect(none.result).toEqual({ ok: true, found: false });
  });

  it("save_patient with an existing phone still creates a new record when a different person shares the phone", async () => {
    const r = await ctx.tools.execute(
      { id: "1", name: "save_patient", arguments: { ...VALID_PATIENT, first_name: "Danny", date_of_birth: "11/02/2002" } },
      meta,
    );
    expect(r.result.ok).toBe(true);
    expect(r.result.action).toBe("created");
    const list = ctx.patients.list({ phone_number: "3125550188" });
    expect(list.total).toBe(2);
  });

  it("update_patient updates the existing record when a returning caller chooses to update", async () => {
    const existing = ctx.patients.findByPhone("3125550188")!;
    const r = await ctx.tools.execute(
      { id: "1", name: "update_patient", arguments: { patient_id: existing.patient_id, city: "Evanston" } },
      meta,
    );
    expect(r.result.ok).toBe(true);
    expect(r.result.action).toBe("updated");
    expect(ctx.patients.get(existing.patient_id).city).toBe("Evanston");
  });

  it("save_patient with invalid data returns a field-specific re-prompt instead of throwing", async () => {
    const r = await ctx.tools.execute({ id: "1", name: "save_patient", arguments: { ...VALID_PATIENT, phone_number: "9999", zip_code: "1" } }, meta);
    expect(r.result.ok).toBe(false);
    expect(r.result.error).toBe("validation_failed");
    expect(r.result.say).toMatch(/ten-digit U.S. phone number/);
  });

  it("database failure produces a graceful spoken error, not silence", async () => {
    const spy = vi.spyOn(ctx.patients, "create").mockImplementation(() => {
      throw new Error("SQLITE_IOERR: disk I/O error");
    });
    const r = await ctx.tools.execute(
      { id: "1", name: "save_patient", arguments: { ...VALID_PATIENT, phone_number: "7735550199" } },
      { ...meta, callId: "call_fail" },
    );
    spy.mockRestore();
    expect(r.result.ok).toBe(false);
    expect(r.result.error).toBe("internal_error");
    expect(r.result.say).toMatch(/wasn't able to save/);
  });

  it("update_patient on a missing record tells the agent to register instead", async () => {
    const r = await ctx.tools.execute(
      { id: "1", name: "update_patient", arguments: { patient_id: "00000000-0000-4000-8000-000000000000", city: "Austin" } },
      meta,
    );
    expect(r.result.error).toBe("not_found");
    expect(r.result.say).toMatch(/register you as a new patient/);
  });

  it("offers appointment slots and books one", async () => {
    const patient = ctx.patients.findByPhone("3125550188")!;
    const slots = await ctx.tools.execute({ id: "1", name: "get_appointment_slots", arguments: {} }, meta);
    expect((slots.result.slots as unknown[]).length).toBe(3);
    const booked = await ctx.tools.execute(
      { id: "2", name: "schedule_appointment", arguments: { patient_id: patient.patient_id, slot_id: "slot-2" } },
      meta,
    );
    expect(booked.result.ok).toBe(true);
    expect(ctx.appointments.listForPatient(patient.patient_id)).toHaveLength(1);
  });

  it("unknown tools are rejected gracefully", async () => {
    const r = await ctx.tools.execute({ id: "1", name: "launch_rockets", arguments: {} }, meta);
    expect(r.result.ok).toBe(false);
  });
});

describe("Vapi webhook", () => {
  const url = "/voice/vapi/webhook";
  const headers = { "x-vapi-secret": "test-secret" };

  it("web-config exposes only the public key, and reports disabled when not configured", async () => {
    const res = await app.inject({ method: "GET", url: "/voice/vapi/web-config" });
    expect(res.statusCode).toBe(200);
    const { data } = json(res);
    expect(data.enabled).toBe(false);
    expect(JSON.stringify(data)).not.toContain("test-secret");
  });

  it("rejects requests without the shared secret", async () => {
    const res = await app.inject({ method: "POST", url, payload: { message: { type: "tool-calls" } } });
    expect(res.statusCode).toBe(401);
  });

  it("executes tool calls in both payload shapes and returns Vapi's results format", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        message: {
          type: "tool-calls",
          call: { id: "vapi_call_1", customer: { number: "+12125550147" } },
          toolCallList: [
            { id: "a", type: "function", function: { name: "validate_field", arguments: { field: "zip_code", value: "10013" } } },
            { id: "b", name: "validate_field", arguments: '{"field":"sex","value":"prefer not to say"}' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const { results } = json(res);
    expect(results).toHaveLength(2);
    expect(results[0].toolCallId).toBe("a");
    expect(JSON.parse(results[0].result)).toEqual({ ok: true, field: "zip_code", value: "10013" });
    expect(JSON.parse(results[1].result).value).toBe("Decline to Answer");
    expect(ctx.calls.get("vapi_call_1")?.caller_number).toBe("+12125550147");
  });

  it("stores transcript and summary from the end-of-call report and marks dropped calls", async () => {
    await app.inject({
      method: "POST",
      url,
      headers,
      payload: { message: { type: "status-update", status: "ended", endedReason: "pipeline-error-openai-llm-failed", call: { id: "vapi_call_2" } } },
    });
    await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        message: {
          type: "end-of-call-report",
          call: { id: "vapi_call_2" },
          summary: "Caller dropped before confirming.",
          artifact: { transcript: "AI: Hi there\nUser: Hello" },
        },
      },
    });
    const call = ctx.calls.get("vapi_call_2");
    expect(call?.status).toBe("dropped");
    expect(call?.outcome).toBe("dropped");
    expect(call?.summary).toBe("Caller dropped before confirming.");
    expect(call?.transcript).toContain("User: Hello");
    expect(call?.ended_at).toBeTruthy();
  });

  it("exposes call history per patient", async () => {
    const patient = ctx.patients.findByPhone("3125550188")!;
    const res = await app.inject({ method: "GET", url: `/patients/${patient.patient_id}/calls` });
    expect(res.statusCode).toBe(200);
    expect(json(res).data[0].call_id).toBe("call_test");
  });
});

describe("normaliseToolCalls", () => {
  it("handles missing or malformed lists", () => {
    expect(normaliseToolCalls(undefined)).toEqual([]);
    expect(normaliseToolCalls([{ id: "x", function: { name: "f", arguments: "{broken" } }])).toEqual([
      { id: "x", name: "f", arguments: {} },
    ]);
  });
});
