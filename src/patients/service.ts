import type { Logger } from "pino";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { PatientRepository } from "./repository.js";
import {
  formatIssues,
  isoToUsDate,
  patientCreateSchema,
  patientFilterSchema,
  patientUpdateSchema,
  type PatientRecord,
} from "./schema.js";

/** API/voice-facing representation: DOB rendered as MM/DD/YYYY per the spec. */
export type PatientDto = Omit<PatientRecord, "date_of_birth"> & { date_of_birth: string };

export function toDto(row: PatientRecord): PatientDto {
  return { ...row, date_of_birth: isoToUsDate(row.date_of_birth) };
}

/**
 * Business logic shared by the REST API and the voice agent.
 * Validation always happens here, so neither entry point can bypass it.
 */
export class PatientService {
  constructor(
    private readonly repo: PatientRepository,
    private readonly log: Logger,
  ) {}

  create(input: unknown): PatientDto {
    const parsed = patientCreateSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(formatIssues(parsed.error));
    const row = this.repo.create(parsed.data);
    this.log.info({ event: "patient.created", patient_id: row.patient_id, payload: redact(row) }, "patient created");
    return toDto(row);
  }

  get(id: string): PatientDto {
    const row = this.repo.findById(id);
    if (!row) throw new NotFoundError();
    return toDto(row);
  }

  findByPhone(phone: unknown): PatientDto | null {
    const parsed = patientCreateSchema.shape.phone_number.safeParse(phone);
    if (!parsed.success) throw new ValidationError({ phone_number: parsed.error.issues[0]?.message ?? "invalid" });
    const row = this.repo.findByPhone(parsed.data);
    return row ? toDto(row) : null;
  }

  list(query: unknown): { items: PatientDto[]; total: number } {
    const parsed = patientFilterSchema.safeParse(query ?? {});
    if (!parsed.success) throw new ValidationError(formatIssues(parsed.error), "Invalid query parameters");
    const { items, total } = this.repo.list(parsed.data);
    return { items: items.map(toDto), total };
  }

  update(id: string, input: unknown): PatientDto {
    const parsed = patientUpdateSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(formatIssues(parsed.error));
    if (!this.repo.findById(id)) throw new NotFoundError();
    const row = this.repo.update(id, parsed.data);
    if (!row) throw new NotFoundError();
    this.log.info({ event: "patient.updated", patient_id: id, fields: Object.keys(parsed.data) }, "patient updated");
    return toDto(row);
  }

  softDelete(id: string): void {
    if (!this.repo.softDelete(id)) throw new NotFoundError();
    this.log.info({ event: "patient.deleted", patient_id: id }, "patient soft-deleted");
  }
}

/** Mask most of the phone/email in logs; this is demo data but the habit matters. */
function redact(row: PatientRecord): Record<string, unknown> {
  return {
    ...row,
    phone_number: row.phone_number.replace(/^\d{6}/, "******"),
    email: row.email ? row.email.replace(/^(.).*(@.*)$/, "$1***$2") : null,
    emergency_contact_phone: row.emergency_contact_phone?.replace(/^\d{6}/, "******") ?? null,
  };
}
