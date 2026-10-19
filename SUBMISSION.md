# Submission — Voice AI Agent, Patient Registration

Take-home technical assessment · Voice AI / Conversational AI Engineer

This file is the packet requested under **Submission Instructions** in the challenge document. Secrets are not included; none are required to review the live system.

---

## 1. Repository

**https://github.com/AbdulBasit4532/voice-ai-agent**

Public. Clone and run locally with `npm install && cp .env.example .env && npm run dev` (see README). API keys are not in the repository; they live in a gitignored `.env` on the demo host.

## 2. Phone number to call

**+1 (307) 487-1026**

U.S. number provisioned with Vapi. The agent is **Maya**, intake coordinator for the fictional clinic **Lakeside Family Health**. Speak naturally. Do not use real patient data.

Suggested path through a first call:

1. Give a name (spell it if asked).
2. Date of birth as `MM/DD/YYYY`, sex, a 10-digit U.S. phone, street / city / state / ZIP.
3. Optional insurance, emergency contact, and language are offered once — you may skip them.
4. Maya reads the record back. Confirm or correct a field.
5. You should hear a short confirmation (“You're all set, …”) and the call should end.

If you cannot dial a U.S. number, use **Talk to Maya** on the landing page (same assistant, same backend).

## 3. API base URL

**https://clerical-parted-enlisted.ngrok-free.dev**

The service is the same process that handles the voice webhooks. Free ngrok may show an interstitial in a browser; click through, or send header `ngrok-skip-browser-warning: 1` on API requests. The landing page and dashboard already send that header.

| What | URL |
|---|---|
| Landing page | https://clerical-parted-enlisted.ngrok-free.dev/ |
| Patient registry UI | https://clerical-parted-enlisted.ngrok-free.dev/dashboard/ |
| Health | https://clerical-parted-enlisted.ngrok-free.dev/health |
| List patients | https://clerical-parted-enlisted.ngrok-free.dev/patients |
| Webhook (Vapi only) | `POST /voice/vapi/webhook` |

### Quick API checks (no credentials)

```bash
BASE=https://clerical-parted-enlisted.ngrok-free.dev
H='ngrok-skip-browser-warning: 1'

curl -s -H "$H" "$BASE/health"
curl -s -H "$H" "$BASE/patients"
curl -s -H "$H" "$BASE/patients?last_name=Doe"
curl -s -H "$H" "$BASE/patients?phone_number=4155550123"
```

Envelope is always `{ "data": ..., "error": null }` on success. Soft-deleted rows are omitted unless `?include_deleted=true`.

Seed records (fictional): Jane Doe, Marcus O'Neil. New registrations from the phone appear in `GET /patients` and on `/dashboard/` immediately.

## 4. Credentials and notes for testing

**No login, API key, or reviewer account is required.** The REST API is unauthenticated by design (fictional data; documented in README).

| Note | Detail |
|---|---|
| Persistence | SQLite file on the demo host. Register on call 1; the record is still there on call 2 and via `GET /patients`. |
| Returning caller | If you reuse a phone already on file, Maya offers to update instead of creating a duplicate. |
| Invalid input | A 3-digit phone or a future date of birth is rejected in speech and re-asked for that field only. Same rules on `POST /patients` (422). |
| Mid-call drop | In-progress calls are marked `dropped`; nothing is saved until the caller confirms the read-back. |
| Start over | Say you want to start over; Maya discards unconfirmed fields and begins again. |
| Browser call | Microphone permission required. Same tools and database as the PSTN number. |
| Spanish | Saying “Hablo español” switches the conversation; stored enums stay in the English schema. |
| Appointments | After a successful save, Maya can offer a mock first appointment (bonus). Transcripts are on the patient detail panel. |
| What not to send | Real PHI. This is not HIPAA-scoped. |

Keep the demo process and ngrok tunnel running for the review window. If the tunnel URL ever changes, the replacement will be the `PUBLIC_BASE_URL` printed in the README deliverable table.

---

## How this maps to the brief

| Requirement | Implementation |
|---|---|
| Real U.S. number, natural conversation (not IVR) | Vapi + GPT-4o + Deepgram nova-3 + ElevenLabs; persona Maya |
| LLM handles phrasing, clarifications, corrections | System prompt in `src/voice/prompt.ts` (design notes in the file header) |
| Read-back and confirm before save | `save_patient` only after explicit confirmation |
| Invalid field → specific re-prompt | Shared Zod schema; tools return a spoken `say` string |
| Persistent database that survives restart | SQLite `./data/patients.db`, CHECK constraints, `updated_at` trigger |
| REST `/patients` CRUD, `{data,error}`, 200/201/400/404/422/500 | Fastify; soft delete via `deleted_at` |
| Agent persists through the same service layer | Tool executor → `PatientService` (same path as the HTTP API) |
| No hardcoded keys | Environment variables only; `.env` gitignored |
| Conversation logging | pino to stdout; `call_logs` with transcript/summary |
| README: setup, architecture, stack, env, trade-offs | `README.md` |

Bonus items shipped: duplicate detection by phone, mock appointment offer, Spanish, call transcripts, dashboard + landing page, Vitest coverage of API and voice tools.

---

## Suggested reviewer script (about five minutes)

1. Dial **+1 (307) 487-1026** and complete a registration as a new patient.
2. Open https://clerical-parted-enlisted.ngrok-free.dev/patients and confirm the record.
3. Call again with the same phone number and confirm Maya offers to update.
4. `POST /patients` with `"date_of_birth": "01/01/2099"` and confirm a 422, not a 500.
5. Restart is not required; the SQLite file already survives process restarts on the demo host.

Architecture, local setup, environment variables, and known limitations are in [README.md](README.md).
