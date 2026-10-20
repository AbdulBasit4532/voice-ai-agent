import { describe, expect, it } from "vitest";
import {
  normalizeDate,
  normalizePhone,
  normalizeSex,
  normalizeState,
  normalizeZip,
  patientCreateSchema,
  validateSingleField,
} from "../src/patients/schema.js";
import { VALID_PATIENT } from "./helpers.js";

describe("normalizers", () => {
  it("normalizes phone numbers to 10 digits", () => {
    expect(normalizePhone("(312) 555-0188")).toBe("3125550188");
    expect(normalizePhone("+1 312 555 0188")).toBe("3125550188");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("0125550188")).toBeNull();
    expect(normalizePhone("31255501889")).toBeNull();
  });

  it("normalizes dates to ISO (including spoken/month-name dates) and rejects impossible ones", () => {
    expect(normalizeDate("03/14/1985")).toBe("1985-03-14");
    expect(normalizeDate("3/4/1985")).toBe("1985-03-04");
    expect(normalizeDate("1985-03-14")).toBe("1985-03-14");
    expect(normalizeDate("November 2, 2002")).toBe("2002-11-02");
    expect(normalizeDate("November second two thousand and two")).toBe("2002-11-02");
    expect(normalizeDate("March fourteenth, nineteen eighty-five")).toBe("1985-03-14");
    expect(normalizeDate("2nd of October, 2002")).toBe("2002-10-02");
    expect(normalizeDate("02/30/1985")).toBeNull();
    expect(normalizeDate("13/01/1985")).toBeNull();
    expect(normalizeDate("yesterday")).toBeNull();
  });

  it("normalizes states from abbreviations and names", () => {
    expect(normalizeState("il")).toBe("IL");
    expect(normalizeState("Illinois")).toBe("IL");
    expect(normalizeState("New York")).toBe("NY");
    expect(normalizeState("ZZ")).toBeNull();
  });

  it("normalizes sex from spoken variants and STT homophones", () => {
    expect(normalizeSex("female")).toBe("Female");
    expect(normalizeSex("M")).toBe("Male");
    expect(normalizeSex("mail")).toBe("Male");
    expect(normalizeSex("m a l e")).toBe("Male");
    expect(normalizeSex("I'd rather not say")).toBe("Decline to Answer");
    expect(normalizeSex("banana")).toBeNull();
  });

  it("normalizes ZIP, ZIP+4, and spoken ZIP digits", () => {
    expect(normalizeZip("60601")).toBe("60601");
    expect(normalizeZip("606011234")).toBe("60601-1234");
    expect(normalizeZip("six zero six zero one")).toBe("60601");
    expect(normalizeZip("6060")).toBeNull();
  });
});

describe("patientCreateSchema", () => {
  it("accepts a valid patient and applies defaults", () => {
    const r = patientCreateSchema.safeParse(VALID_PATIENT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone_number).toBe("3125550188");
      expect(r.data.date_of_birth).toBe("1990-07-04");
      expect(r.data.preferred_language).toBe("English");
      expect(r.data.email).toBeNull();
    }
  });

  it("rejects a future date of birth", () => {
    const r = patientCreateSchema.safeParse({ ...VALID_PATIENT, date_of_birth: "01/01/2999" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/future/);
  });

  it("rejects names with digits but allows hyphens and apostrophes", () => {
    expect(patientCreateSchema.safeParse({ ...VALID_PATIENT, last_name: "D4vis" }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...VALID_PATIENT, last_name: "O'Neil-Smith" }).success).toBe(true);
  });

  it("rejects invalid email but allows it to be omitted or empty", () => {
    expect(patientCreateSchema.safeParse({ ...VALID_PATIENT, email: "nope" }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...VALID_PATIENT, email: "" }).success).toBe(true);
  });

  it("normalises insurance member ids", () => {
    const r = patientCreateSchema.safeParse({ ...VALID_PATIENT, insurance_member_id: "abc-123 456" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.insurance_member_id).toBe("ABC123456");
  });

  it("rejects unknown fields", () => {
    expect(patientCreateSchema.safeParse({ ...VALID_PATIENT, ssn: "123" }).success).toBe(false);
  });
});

describe("validateSingleField", () => {
  it("validates one field at a time", () => {
    expect(validateSingleField("phone_number", "555-0188")).toEqual({ ok: false, message: expect.stringMatching(/10-digit/) });
    expect(validateSingleField("state", "texas")).toEqual({ ok: true, value: "TX" });
    expect(validateSingleField("not_a_field", "x").ok).toBe(false);
  });
});
