import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";

export interface Appointment {
  appointment_id: string;
  patient_id: string;
  scheduled_for: string;
  provider_name: string;
  reason: string | null;
  status: "scheduled" | "cancelled";
  created_at: string;
}

export interface Slot {
  slot_id: string;
  scheduled_for: string;
  spoken: string;
  provider_name: string;
}

const PROVIDERS = ["Dr. Patel", "Dr. Nguyen", "Dr. Alvarez"];

/**
 * Bonus feature: mock appointment scheduling.
 * Slots are generated deterministically from the current date (next 3 business days,
 * 9:30 / 1:00 / 3:30 local-ish times expressed in UTC) so there is no calendar dependency.
 */
export class AppointmentService {
  constructor(private readonly db: Db) {}

  availableSlots(): Slot[] {
    const slots: Slot[] = [];
    const base = new Date();
    base.setUTCHours(0, 0, 0, 0);
    const hours = [9.5, 13, 15.5];
    let dayOffset = 1;
    let i = 0;
    while (slots.length < 3) {
      const day = new Date(base);
      day.setUTCDate(base.getUTCDate() + dayOffset);
      const dow = day.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        const h = hours[i % hours.length];
        day.setUTCHours(Math.floor(h), (h % 1) * 60, 0, 0);
        slots.push({
          slot_id: `slot-${slots.length + 1}`,
          scheduled_for: day.toISOString(),
          spoken: formatSpoken(day),
          provider_name: PROVIDERS[i % PROVIDERS.length],
        });
        i += 1;
      }
      dayOffset += 1;
    }
    return slots;
  }

  resolveSlot(slotId: string): Slot | undefined {
    const slots = this.availableSlots();
    const raw = (slotId ?? "").trim();
    if (!raw) return undefined;
    const lower = raw.toLowerCase();

    // 1. Exact slot_id or ISO timestamp match
    const exact = slots.find((s) => s.slot_id.toLowerCase() === lower || s.scheduled_for.toLowerCase() === lower);
    if (exact) return exact;

    // 2. Ordinal / numeric choice ("1", "slot 1", "option 1", "first", etc.)
    if (/^(slot[\s\-_]*)?1$|^(option[\s\-_]*)?1$|\bfirst\b/.test(lower)) return slots[0];
    if (/^(slot[\s\-_]*)?2$|^(option[\s\-_]*)?2$|\bsecond\b/.test(lower)) return slots[1];
    if (/^(slot[\s\-_]*)?3$|^(option[\s\-_]*)?3$|\bthird\b/.test(lower)) return slots[2];

    // 3. Provider name match ("Dr. Patel", "Patel", "Nguyen", "Alvarez")
    const byProvider = slots.find((s) => {
      const pLower = s.provider_name.toLowerCase();
      const lastName = pLower.replace(/^dr\.?\s*/i, "");
      return lower.includes(pLower) || (lastName.length > 2 && lower.includes(lastName));
    });
    if (byProvider) return byProvider;

    // 4. Spoken date / weekday / time substring match ("Wednesday", "9:30", "1:00", "3:30")
    const bySpoken = slots.find((s) => {
      const spLower = s.spoken.toLowerCase();
      return spLower.includes(lower) || lower.includes(spLower);
    });
    if (bySpoken) return bySpoken;

    return undefined;
  }

  book(patientId: string, slotId: string, reason?: string | null): Appointment {
    const slot = this.resolveSlot(slotId);
    if (!slot) throw new ValidationError({ slot_id: "is not one of the offered slots" });
    const patient = this.db
      .prepare("SELECT patient_id FROM patients WHERE patient_id = ? AND deleted_at IS NULL")
      .get(patientId);
    if (!patient) throw new NotFoundError();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO appointments (appointment_id, patient_id, scheduled_for, provider_name, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, patientId, slot.scheduled_for, slot.provider_name, reason ?? null);
    return this.db.prepare("SELECT * FROM appointments WHERE appointment_id = ?").get(id) as Appointment;
  }

  listForPatient(patientId: string): Appointment[] {
    return this.db
      .prepare("SELECT * FROM appointments WHERE patient_id = ? ORDER BY scheduled_for")
      .all(patientId) as Appointment[];
  }
}

function formatSpoken(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
