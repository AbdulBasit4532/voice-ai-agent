import type { Logger } from "pino";
import type { AppointmentService } from "../appointments/service.js";
import type { CallLogRepository } from "../calls/repository.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { isoToUsDate, validateSingleField } from "../patients/schema.js";
import type { PatientDto, PatientService } from "../patients/service.js";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** JSON-serialisable payload handed back to the LLM. */
  result: Record<string, unknown>;
}

export interface CallMeta {
  callId: string;
  callerNumber?: string | null;
  provider?: string;
}

interface Deps {
  patients: PatientService;
  calls: CallLogRepository;
  appointments: AppointmentService;
  log: Logger;
}

/**
 * Speech-friendly re-prompts keyed by field. The model is told to use `say` verbatim,
 * which keeps error handling consistent across calls and languages of the model's choosing.
 */
const FIELD_REPROMPTS: Record<string, string> = {
  first_name: "I didn't quite catch a valid first name. Could you spell it for me, letter by letter?",
  last_name: "I didn't quite catch a valid last name. Could you spell it for me, letter by letter?",
  date_of_birth: "That date doesn't look right. Could you give me your date of birth again, month, day, and year? For example, March fourteenth, nineteen eighty-five.",
  sex: "Sorry, for sex I can record male, female, other, or decline to answer. Which would you like?",
  phone_number: "I need a ten-digit U.S. phone number, area code first. Could you say it again slowly?",
  email: "That email didn't come through correctly. Could you spell it out, including the part after the at sign?",
  address_line_1: "Could you give me your street address again, with the house number and street name?",
  city: "Sorry, what city was that?",
  state: "I need the state as well. Which state is that?",
  zip_code: "I need a five-digit ZIP code. Could you say it digit by digit?",
  insurance_provider: "What's the name of your insurance company?",
  insurance_member_id: "Could you read me the member ID on your insurance card, letters and numbers only?",
  preferred_language: "Which language do you prefer we use?",
  emergency_contact_name: "Who should we list as your emergency contact? First and last name, please.",
  emergency_contact_phone: "I need a ten-digit phone number for your emergency contact. Could you say it again?",
};

const FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  date_of_birth: "date of birth",
  sex: "sex",
  phone_number: "phone number",
  email: "email",
  address_line_1: "street address",
  address_line_2: "apartment or unit",
  city: "city",
  state: "state",
  zip_code: "ZIP code",
  insurance_provider: "insurance provider",
  insurance_member_id: "insurance member ID",
  preferred_language: "preferred language",
  emergency_contact_name: "emergency contact name",
  emergency_contact_phone: "emergency contact phone",
};

const SAVE_FAILED_MESSAGE =
  "I'm sorry, I wasn't able to save your information just now because of a problem on our end. Would you like me to try again, or you're welcome to call back in a few minutes.";

/**
 * Executes tool calls from the LLM against the service layer.
 * Every result includes `ok` and, when something went wrong, a `say` string with the exact
 * sentence the agent should speak. The executor never throws: failures become spoken messages,
 * so the caller is never met with silence if the database is down.
 */
export class ToolExecutor {
  constructor(private readonly deps: Deps) {}

  async execute(call: ToolCall, meta: CallMeta): Promise<ToolResult> {
    const log = this.deps.log.child({ call_id: meta.callId, tool: call.name });
    try {
      const result = await this.dispatch(call, meta, log);
      log.info({ event: "tool.result", ok: result.ok, args: summarise(call.arguments) }, "tool executed");
      return { id: call.id, name: call.name, result };
    } catch (err) {
      log.error({ err, args: summarise(call.arguments) }, "tool failed");
      const result = this.describeFailure(call.name, err);
      return { id: call.id, name: call.name, result };
    }
  }

  private async dispatch(call: ToolCall, meta: CallMeta, log: Logger): Promise<Record<string, unknown>> {
    const args = call.arguments ?? {};
    switch (call.name) {
      case "validate_field":
        return this.validateField(String(args.field ?? ""), args.value);
      case "lookup_patient_by_phone":
        return this.lookupByPhone(args.phone_number, meta);
      case "save_patient":
        return this.savePatient(args, meta, log);
      case "update_patient":
        return this.updatePatient(args, meta, log);
      case "get_appointment_slots":
        return { ok: true, slots: this.deps.appointments.availableSlots() };
      case "schedule_appointment":
        return this.scheduleAppointment(args);
      case "log_call_outcome":
        this.deps.calls.ensure(meta.callId, meta.provider, meta.callerNumber ?? null);
        this.deps.calls.update(meta.callId, {
          outcome: String(args.outcome ?? "abandoned"),
          summary: args.note ? String(args.note) : null,
        });
        return { ok: true };
      default:
        return { ok: false, say: "I'm sorry, I can't do that from here.", error: `unknown tool ${call.name}` };
    }
  }

  private validateField(field: string, value: unknown): Record<string, unknown> {
    if (!field || value === undefined || value === null) {
      return { ok: false, field, say: FIELD_REPROMPTS[field] ?? "Sorry, could you repeat that?" };
    }
    const r = validateSingleField(field, String(value));
    if (r.ok) {
      const normalised = field === "date_of_birth" ? isoToUsDate(String(r.value)) : r.value;
      return { ok: true, field, value: normalised };
    }
    return {
      ok: false,
      field,
      reason: `${FIELD_LABELS[field] ?? field} ${r.message}`,
      say: FIELD_REPROMPTS[field] ?? `Sorry, that ${FIELD_LABELS[field] ?? field} doesn't look right. Could you repeat it?`,
    };
  }

  private lookupByPhone(phone: unknown, meta: CallMeta): Record<string, unknown> {
    const existing = this.deps.patients.findByPhone(String(phone ?? ""));
    if (!existing) return { ok: true, found: false };
    this.deps.calls.ensure(meta.callId, meta.provider, meta.callerNumber ?? null);
    return {
      ok: true,
      found: true,
      patient: publicView(existing),
      say: `It looks like we already have a record for ${existing.first_name} ${existing.last_name}. Would you like to update your information instead?`,
    };
  }

  private savePatient(args: Record<string, unknown>, meta: CallMeta, log: Logger): Record<string, unknown> {
    const payload = stripEmpty(args);
    // Observability requirement: the final collected payload goes to stdout before the write.
    log.info({ event: "voice.collected_payload", call_id: meta.callId, payload }, "final collected patient payload");

    const existing = payload.phone_number ? this.deps.patients.findByPhone(String(payload.phone_number)) : null;
    if (existing) {
      // Guardrail: the model should have used update_patient; do the right thing instead of duplicating.
      const updated = this.deps.patients.update(existing.patient_id, payload);
      this.recordOutcome(meta, updated.patient_id, "updated", payload);
      return {
        ok: true,
        action: "updated",
        patient_id: updated.patient_id,
        say: `You're all set, ${updated.first_name}. I've updated your existing record.`,
      };
    }

    const created = this.deps.patients.create(payload);
    this.recordOutcome(meta, created.patient_id, "registered", payload);
    return {
      ok: true,
      action: "created",
      patient_id: created.patient_id,
      say: `You're all set, ${created.first_name}. You're registered with us.`,
    };
  }

  private updatePatient(args: Record<string, unknown>, meta: CallMeta, log: Logger): Record<string, unknown> {
    const { patient_id, ...rest } = args;
    const payload = stripEmpty(rest);
    log.info({ event: "voice.collected_payload", call_id: meta.callId, patient_id, payload }, "update payload");
    const updated = this.deps.patients.update(String(patient_id ?? ""), payload);
    this.recordOutcome(meta, updated.patient_id, "updated", payload);
    return {
      ok: true,
      action: "updated",
      patient_id: updated.patient_id,
      say: `Thanks, ${updated.first_name}. Your information is updated.`,
    };
  }

  private scheduleAppointment(args: Record<string, unknown>): Record<string, unknown> {
    const appt = this.deps.appointments.book(
      String(args.patient_id ?? ""),
      String(args.slot_id ?? ""),
      args.reason ? String(args.reason) : null,
    );
    const slot = this.deps.appointments.availableSlots().find((s) => s.scheduled_for === appt.scheduled_for);
    return {
      ok: true,
      appointment_id: appt.appointment_id,
      scheduled_for: appt.scheduled_for,
      spoken: slot?.spoken ?? appt.scheduled_for,
      provider_name: appt.provider_name,
      say: `You're booked with ${appt.provider_name} on ${slot?.spoken ?? appt.scheduled_for}.`,
    };
  }

  private recordOutcome(meta: CallMeta, patientId: string, outcome: string, payload: Record<string, unknown>): void {
    try {
      this.deps.calls.ensure(meta.callId, meta.provider, meta.callerNumber ?? null);
      this.deps.calls.update(meta.callId, { patient_id: patientId, outcome, collected_data: JSON.stringify(payload) });
    } catch (err) {
      // Logging the call must never break the registration itself.
      this.deps.log.warn({ err, call_id: meta.callId }, "failed to record call outcome");
    }
  }

  /** Converts any thrown error into a result the model can speak. */
  private describeFailure(tool: string, err: unknown): Record<string, unknown> {
    if (err instanceof ValidationError) {
      const fields = err.fields;
      const [firstField] = Object.keys(fields);
      const problems = Object.entries(fields).map(([f, m]) => `${FIELD_LABELS[f] ?? f} ${m}`);
      return {
        ok: false,
        error: "validation_failed",
        fields,
        say:
          firstField && FIELD_REPROMPTS[firstField]
            ? `Before I can save this, one detail needs fixing. ${FIELD_REPROMPTS[firstField]}`
            : `Before I can save this, a few details need fixing: ${problems.join("; ")}.`,
      };
    }
    if (err instanceof AppError && err.status === 404) {
      return {
        ok: false,
        error: "not_found",
        say: "I couldn't find that record anymore. Let's go ahead and register you as a new patient instead.",
      };
    }
    const isWrite = tool === "save_patient" || tool === "update_patient" || tool === "schedule_appointment";
    return {
      ok: false,
      error: "internal_error",
      say: isWrite ? SAVE_FAILED_MESSAGE : "Sorry, something went wrong on my end. Let's keep going and I'll try that again in a moment.",
    };
  }
}

function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

function publicView(p: PatientDto) {
  return {
    patient_id: p.patient_id,
    first_name: p.first_name,
    last_name: p.last_name,
    date_of_birth: p.date_of_birth,
    sex: p.sex,
    phone_number: p.phone_number,
    email: p.email,
    address_line_1: p.address_line_1,
    address_line_2: p.address_line_2,
    city: p.city,
    state: p.state,
    zip_code: p.zip_code,
    insurance_provider: p.insurance_provider,
    insurance_member_id: p.insurance_member_id,
    preferred_language: p.preferred_language,
    emergency_contact_name: p.emergency_contact_name,
    emergency_contact_phone: p.emergency_contact_phone,
  };
}

function summarise(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = typeof v === "string" && v.length > 60 ? `${v.slice(0, 57)}...` : v;
  }
  return out;
}
