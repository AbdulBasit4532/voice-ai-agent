import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import type { PatientCreate, PatientFilter, PatientRecord, PatientUpdate } from "./schema.js";

const COLUMNS = [
  "first_name", "last_name", "date_of_birth", "sex", "phone_number", "email",
  "address_line_1", "address_line_2", "city", "state", "zip_code",
  "insurance_provider", "insurance_member_id", "preferred_language",
  "emergency_contact_name", "emergency_contact_phone",
] as const;

type Column = (typeof COLUMNS)[number];

/**
 * Thin data-access layer. All SQL for the patients table lives here.
 * Only parameterised statements are used, so user input never touches SQL text.
 */
export class PatientRepository {
  constructor(private readonly db: Db) {}

  create(input: PatientCreate): PatientRecord {
    const id = randomUUID();
    const row: Record<string, unknown> = { patient_id: id };
    for (const c of COLUMNS) row[c] = (input as Record<string, unknown>)[c] ?? null;
    if (!row.preferred_language) row.preferred_language = "English";

    const cols = ["patient_id", ...COLUMNS];
    this.db
      .prepare(`INSERT INTO patients (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`)
      .run(row);
    return this.findById(id, true) as PatientRecord;
  }

  findById(id: string, includeDeleted = false): PatientRecord | undefined {
    const sql = includeDeleted
      ? "SELECT * FROM patients WHERE patient_id = ?"
      : "SELECT * FROM patients WHERE patient_id = ? AND deleted_at IS NULL";
    return this.db.prepare(sql).get(id) as PatientRecord | undefined;
  }

  findByPhone(phone: string): PatientRecord | undefined {
    return this.db
      .prepare("SELECT * FROM patients WHERE phone_number = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(phone) as PatientRecord | undefined;
  }

  list(filter: PatientFilter): { items: PatientRecord[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (!filter.include_deleted) where.push("deleted_at IS NULL");
    if (filter.last_name) {
      where.push("lower(last_name) = lower(@last_name)");
      params.last_name = filter.last_name;
    }
    if (filter.date_of_birth) {
      where.push("date_of_birth = @date_of_birth");
      params.date_of_birth = filter.date_of_birth;
    }
    if (filter.phone_number) {
      where.push("phone_number = @phone_number");
      params.phone_number = filter.phone_number;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (
      this.db.prepare(`SELECT count(*) AS n FROM patients ${whereSql}`).get(params) as { n: number }
    ).n;
    const items = this.db
      .prepare(`SELECT * FROM patients ${whereSql} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: filter.limit, offset: filter.offset }) as PatientRecord[];
    return { items, total };
  }

  update(id: string, patch: PatientUpdate): PatientRecord | undefined {
    const entries = Object.entries(patch).filter(([k]) => (COLUMNS as readonly string[]).includes(k)) as [
      Column,
      unknown,
    ][];
    if (entries.length === 0) return this.findById(id);
    const sets = entries.map(([k]) => `${k} = @${k}`);
    const params: Record<string, unknown> = { patient_id: id, updated_at: new Date().toISOString() };
    for (const [k, v] of entries) params[k] = v ?? null;
    const result = this.db
      .prepare(
        `UPDATE patients SET ${sets.join(", ")}, updated_at = @updated_at WHERE patient_id = @patient_id AND deleted_at IS NULL`,
      )
      .run(params);
    if (result.changes === 0) return undefined;
    return this.findById(id);
  }

  softDelete(id: string): boolean {
    const result = this.db
      .prepare("UPDATE patients SET deleted_at = ?, updated_at = ? WHERE patient_id = ? AND deleted_at IS NULL")
      .run(new Date().toISOString(), new Date().toISOString(), id);
    return result.changes > 0;
  }

  count(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM patients").get() as { n: number }).n;
  }
}
