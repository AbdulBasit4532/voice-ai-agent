import type { Db } from "../db/connection.js";

export interface CallLog {
  call_id: string;
  provider: string;
  patient_id: string | null;
  caller_number: string | null;
  status: "in-progress" | "completed" | "dropped" | "failed";
  outcome: string | null;
  ended_reason: string | null;
  summary: string | null;
  transcript: string | null;
  collected_data: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallLogPatch {
  patient_id?: string | null;
  caller_number?: string | null;
  status?: CallLog["status"];
  outcome?: string | null;
  ended_reason?: string | null;
  summary?: string | null;
  transcript?: string | null;
  collected_data?: string | null;
  ended_at?: string | null;
}

/**
 * Stores one row per voice call. Rows are created lazily on the first webhook
 * we see for a call id, then enriched by tool calls and the end-of-call report.
 */
export class CallLogRepository {
  constructor(private readonly db: Db) {}

  ensure(callId: string, provider = "vapi", callerNumber: string | null = null): CallLog {
    this.db
      .prepare(
        `INSERT INTO call_logs (call_id, provider, caller_number) VALUES (?, ?, ?)
         ON CONFLICT(call_id) DO UPDATE SET caller_number = coalesce(call_logs.caller_number, excluded.caller_number)`,
      )
      .run(callId, provider, callerNumber);
    return this.get(callId) as CallLog;
  }

  get(callId: string): CallLog | undefined {
    return this.db.prepare("SELECT * FROM call_logs WHERE call_id = ?").get(callId) as CallLog | undefined;
  }

  update(callId: string, patch: CallLogPatch): CallLog | undefined {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.get(callId);
    const sets = entries.map(([k]) => `${k} = @${k}`).join(", ");
    const params: Record<string, unknown> = { call_id: callId, updated_at: new Date().toISOString() };
    for (const [k, v] of entries) params[k] = v;
    this.db.prepare(`UPDATE call_logs SET ${sets}, updated_at = @updated_at WHERE call_id = @call_id`).run(params);
    return this.get(callId);
  }

  listForPatient(patientId: string): CallLog[] {
    return this.db
      .prepare("SELECT * FROM call_logs WHERE patient_id = ? ORDER BY started_at DESC")
      .all(patientId) as CallLog[];
  }

  listRecent(limit = 50): CallLog[] {
    return this.db.prepare("SELECT * FROM call_logs ORDER BY started_at DESC LIMIT ?").all(limit) as CallLog[];
  }
}
