import { z } from "zod";

/**
 * Single source of truth for patient validation.
 * Used by the REST API (server-side validation) and by the voice agent's tools,
 * so the phone agent can never persist something the API would reject.
 *
 * Normalisation happens here too (phones -> 10 digits, DOB -> ISO, state -> upper-case),
 * which keeps the database clean and makes duplicate detection by phone reliable.
 */

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP",
] as const;

const STATE_NAMES: Record<string, string> = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA", colorado:"CO", connecticut:"CT",
  delaware:"DE", florida:"FL", georgia:"GA", hawaii:"HI", idaho:"ID", illinois:"IL", indiana:"IN", iowa:"IA",
  kansas:"KS", kentucky:"KY", louisiana:"LA", maine:"ME", maryland:"MD", massachusetts:"MA", michigan:"MI",
  minnesota:"MN", mississippi:"MS", missouri:"MO", montana:"MT", nebraska:"NE", nevada:"NV",
  "new hampshire":"NH", "new jersey":"NJ", "new mexico":"NM", "new york":"NY", "north carolina":"NC",
  "north dakota":"ND", ohio:"OH", oklahoma:"OK", oregon:"OR", pennsylvania:"PA", "rhode island":"RI",
  "south carolina":"SC", "south dakota":"SD", tennessee:"TN", texas:"TX", utah:"UT", vermont:"VT",
  virginia:"VA", washington:"WA", "west virginia":"WV", wisconsin:"WI", wyoming:"WY",
  "district of columbia":"DC", "washington dc":"DC", "puerto rico":"PR",
};

export const SEX_VALUES = ["Male", "Female", "Other", "Decline to Answer"] as const;
export type Sex = (typeof SEX_VALUES)[number];

// ---------- helpers ----------

export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3, 4))) return null;
  return digits;
}

/** Accepts MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD. Returns ISO YYYY-MM-DD or null. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    m = Number(match[1]); d = Number(match[2]); y = Number(match[3]);
  } else if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

export function isoToUsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function isNotFuture(iso: string): boolean {
  return iso <= new Date().toISOString().slice(0, 10);
}

function isPlausibleAge(iso: string): boolean {
  return Number(iso.slice(0, 4)) >= 1900;
}

export function normalizeState(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const upper = s.toUpperCase().replace(/\./g, "");
  if ((US_STATES as readonly string[]).includes(upper)) return upper;
  const byName = STATE_NAMES[s.toLowerCase()];
  return byName ?? null;
}

export function normalizeSex(raw: string): Sex | null {
  const s = raw.trim().toLowerCase();
  if (["male", "m", "man"].includes(s)) return "Male";
  if (["female", "f", "woman"].includes(s)) return "Female";
  if (["other", "non-binary", "nonbinary", "intersex"].includes(s)) return "Other";
  if (/decline|prefer not|rather not|skip/.test(s)) return "Decline to Answer";
  return null;
}

export function normalizeZip(raw: string): string | null {
  const s = raw.replace(/\s+/g, "");
  if (/^\d{5}$/.test(s)) return s;
  if (/^\d{5}-?\d{4}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(-4)}`;
  return null;
}

const trimmed = (max: number) => z.string().trim().min(1).max(max);

// Unicode letters, spaces, hyphens and apostrophes (covers O'Brien, Smith-Jones, José).
const NAME_RE = /^[\p{L}][\p{L} '\-]*$/u;

// ---------- field schemas ----------

const nameField = z
  .string()
  .trim()
  .min(1, "is required")
  .max(50, "must be 50 characters or fewer")
  .regex(NAME_RE, "may only contain letters, spaces, hyphens and apostrophes");

const dobField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const iso = normalizeDate(v);
    if (!iso) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid date in MM/DD/YYYY format" });
      return z.NEVER;
    }
    if (!isNotFuture(iso)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cannot be in the future" });
      return z.NEVER;
    }
    if (!isPlausibleAge(iso)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be after 1900" });
      return z.NEVER;
    }
    return iso;
  });

const sexField = z.string().trim().transform((v, ctx) => {
  const sex = normalizeSex(v);
  if (!sex) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be one of ${SEX_VALUES.join(", ")}` });
    return z.NEVER;
  }
  return sex;
});

const phoneField = z.string().trim().transform((v, ctx) => {
  const digits = normalizePhone(v);
  if (!digits) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid 10-digit U.S. phone number" });
    return z.NEVER;
  }
  return digits;
});

const emailField = z.string().trim().toLowerCase().email("must be a valid email address").max(254);

const stateField = z.string().trim().transform((v, ctx) => {
  const st = normalizeState(v);
  if (!st) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid 2-letter U.S. state abbreviation" });
    return z.NEVER;
  }
  return st;
});

const zipField = z.string().trim().transform((v, ctx) => {
  const zip = normalizeZip(v);
  if (!zip) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a 5-digit ZIP or ZIP+4 (12345-6789)" });
    return z.NEVER;
  }
  return zip;
});

const memberIdField = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-]/g, "").toUpperCase())
  .pipe(z.string().min(1).max(50).regex(/^[A-Z0-9]+$/, "must be alphanumeric"));

/** Optional string fields: empty string / null are treated as "not provided". */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), schema.nullable().optional());

// ---------- composite schemas ----------

export const patientCreateSchema = z
  .object({
    first_name: nameField,
    last_name: nameField,
    date_of_birth: dobField,
    sex: sexField,
    phone_number: phoneField,
    email: optional(emailField),
    address_line_1: trimmed(200),
    address_line_2: optional(trimmed(200)),
    city: trimmed(100),
    state: stateField,
    zip_code: zipField,
    insurance_provider: optional(trimmed(100)),
    insurance_member_id: optional(memberIdField),
    preferred_language: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? "English" : v),
      trimmed(50),
    ),
    emergency_contact_name: optional(
      z.string().trim().min(1).max(100).regex(NAME_RE, "may only contain letters, spaces, hyphens and apostrophes"),
    ),
    emergency_contact_phone: optional(phoneField),
  })
  .strict();

export const patientUpdateSchema = patientCreateSchema.partial().refine(
  (obj) => Object.keys(obj).length > 0,
  { message: "at least one field must be provided" },
);

export const patientFilterSchema = z
  .object({
    last_name: z.string().trim().min(1).max(50).optional(),
    date_of_birth: dobField.optional(),
    phone_number: phoneField.optional(),
    include_deleted: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const uuidSchema = z.string().uuid();

export type PatientCreateInput = z.input<typeof patientCreateSchema>;
export type PatientCreate = z.output<typeof patientCreateSchema>;
export type PatientUpdate = z.output<typeof patientUpdateSchema>;
export type PatientFilter = z.output<typeof patientFilterSchema>;

/** Row shape as stored in / returned from the database. */
export interface PatientRecord extends PatientCreate {
  patient_id: string;
  email: string | null;
  address_line_2: string | null;
  insurance_provider: string | null;
  insurance_member_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Flattens Zod issues into { field: message } for API responses and voice re-prompts. */
export function formatIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Validates a single field in isolation (used by the voice agent as the caller speaks). */
export function validateSingleField(field: string, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const shape = patientCreateSchema.shape as Record<string, z.ZodTypeAny>;
  const schema = shape[field];
  if (!schema) return { ok: false, message: `unknown field "${field}"` };
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "is invalid" };
}
