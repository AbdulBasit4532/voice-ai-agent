import pino from "pino";
import { config } from "../config.js";
import { PatientRepository } from "../patients/repository.js";
import { PatientService } from "../patients/service.js";
import type { PatientCreateInput } from "../patients/schema.js";
import { openDatabase, type Db } from "./connection.js";

/** Two demo records so the API and dashboard are not empty on first boot. Not real people. */
export const SEED_PATIENTS: PatientCreateInput[] = [
  {
    first_name: "Jane",
    last_name: "Doe",
    date_of_birth: "03/14/1985",
    sex: "Female",
    phone_number: "4155550123",
    email: "jane.doe@example.com",
    address_line_1: "742 Evergreen Terrace",
    address_line_2: "Apt 2B",
    city: "San Francisco",
    state: "CA",
    zip_code: "94110",
    insurance_provider: "Blue Shield of California",
    insurance_member_id: "BSC123456789",
    preferred_language: "English",
    emergency_contact_name: "John Doe",
    emergency_contact_phone: "4155550199",
  },
  {
    first_name: "Marcus",
    last_name: "O'Neil",
    date_of_birth: "11/02/1972",
    sex: "Male",
    phone_number: "2125550147",
    address_line_1: "88 Lafayette Street",
    city: "New York",
    state: "NY",
    zip_code: "10013-1234",
    preferred_language: "Spanish",
  },
];

/** Inserts seed patients only when the table is empty, so restarts never duplicate them. */
export function seedIfEmpty(db: Db, log: pino.Logger): number {
  const repo = new PatientRepository(db);
  if (repo.count() > 0) return 0;
  const service = new PatientService(repo, log);
  for (const p of SEED_PATIENTS) service.create(p);
  log.info({ count: SEED_PATIENTS.length }, "seeded demo patients");
  return SEED_PATIENTS.length;
}

const isDirectRun = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isDirectRun) {
  const log = pino({ level: "info" });
  const db = openDatabase(config.DATABASE_PATH);
  const n = seedIfEmpty(db, log);
  log.info({ inserted: n, database: config.DATABASE_PATH }, n ? "seed complete" : "database already has patients");
  db.close();
}
