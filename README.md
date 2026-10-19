# Voice AI Patient Registration

A voice agent that answers a real U.S. phone number, registers a new patient through natural conversation, persists the record to a database, and exposes it through a REST API, a landing page, and a dashboard.

## For reviewers (submission)

These four items are what the challenge document asks you to send. The same values live in [SUBMISSION.md](SUBMISSION.md).

| Item | Value |
|---|---|
| Repository | **https://github.com/AbdulBasit4532/voice-ai-agent** |
| Phone number | **+1 (307) 487-1026** |
| API base URL | **https://clerical-parted-enlisted.ngrok-free.dev** |
| Credentials | **None.** The API is open (fictional data). Browser interstitial on free ngrok: click through, or send `ngrok-skip-browser-warning: 1`. |

| Surface | URL |
|---|---|
| Landing page | https://clerical-parted-enlisted.ngrok-free.dev/ |
| Dashboard | https://clerical-parted-enlisted.ngrok-free.dev/dashboard/ |
| Health | https://clerical-parted-enlisted.ngrok-free.dev/health |
| Patients | https://clerical-parted-enlisted.ngrok-free.dev/patients |
| Browser call | **Talk to Maya** on `/` or `/dashboard/` (same agent as the phone line) |

> Fictional clinic, fictional data. Do not enter real patient information.

---

## Contents

- [For reviewers (submission)](#for-reviewers-submission)
- [Architecture](#architecture)
- [Tech stack and why](#tech-stack-and-why)
- [Quick start (local)](#quick-start-local)
- [Go live (phone number)](#go-live-phone-number)
- [Environment variables](#environment-variables)
- [REST API](#rest-api)
- [Data model](#data-model)
- [The voice agent](#the-voice-agent)
- [Edge cases and resilience](#edge-cases-and-resilience)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Trade-offs and known limitations](#trade-offs-and-known-limitations)
- [Next steps](#next-steps)

---

## Architecture

```
  Caller ──PSTN──▶ Vapi (telephony · Deepgram STT · GPT-4o · ElevenLabs TTS)
                       │
                       │  HTTPS webhooks: tool-calls, status-update, end-of-call-report
                       ▼
             ┌────────────────────────────────────────────────────┐
             │  Fastify service (this repo)                        │
             │                                                     │
             │  /voice/vapi/webhook ─▶ ToolExecutor ─┐             │
             │                                       ▼             │
             │  /patients (REST) ────────────▶ PatientService      │
             │  /  landing · /dashboard/ UI ─┘       │             │
             │                                       ▼             │
             │                          PatientRepository ─▶ SQLite│
             │                          CallLogRepository ─▶ (file)│
             │                          AppointmentService         │
             └────────────────────────────────────────────────────┘
```

**Separation of concerns**

| Layer | Owns | Files |
|---|---|---|
| Telephony / voice | Phone number, STT, TTS, barge-in, LLM turn loop | Vapi (configured by `src/voice/vapi/assistant.ts`) |
| LLM logic | System prompt, tool contracts, spoken error messages | `src/voice/prompt.ts`, `src/voice/tools.ts`, `src/voice/toolExecutor.ts` |
| Provider adapter | Webhook parsing, auth, transcript capture | `src/voice/vapi/routes.ts` |
| Domain / data | Validation, business rules, persistence | `src/patients/*`, `src/calls/*`, `src/appointments/*`, `src/db/*` |
| API | HTTP envelope, status codes, routing | `src/patients/routes.ts`, `src/app.ts` |

The voice agent and the REST API share the **same `PatientService` and the same Zod schema**, so the agent cannot persist anything the API would reject. Every tool call from the LLM is validated server-side.

### Call flow

1. Vapi answers and speaks the first message.
2. For each answer the caller gives, the model calls `validate_field`; invalid values come back with a ready-to-speak re-prompt for *that field only*.
3. When a phone number is captured, `lookup_patient_by_phone` runs; a match triggers the "would you like to update instead?" branch.
4. After required fields, the agent offers the optional group (insurance, emergency contact, language) in one sentence.
5. Full read-back → caller confirms → `save_patient` (or `update_patient`).
6. The tool result includes `say` ("You're all set, Sarah…") or an honest failure message. The agent then offers a mock first appointment and ends the call.
7. Vapi posts an `end-of-call-report`; the transcript and summary are stored in `call_logs` linked to the patient and logged to stdout.

---

## Tech stack and why

| Choice | Reason |
|---|---|
| **Vapi** for telephony + STT/TTS + orchestration | Fastest path to a real, dialable number with sub-second turn-taking, barge-in and voicemail detection handled. Our code stays focused on prompt, tools and data. A different provider (Retell, Twilio Media Streams) would only need a new adapter under `src/voice/<provider>/`. |
| **OpenAI GPT-4o** | Strong function-calling reliability, which is what makes field-level validation and the confirmation gate dependable. |
| **Deepgram nova-3 (`multi`)** | Accurate on spelled-out names and numbers; multilingual mode enables the Spanish bonus without a second assistant. |
| **Node 22 + TypeScript + Fastify** | Small, fast, typed. Fastify's `inject()` makes API tests run without opening a port. |
| **Zod** | One schema for validation *and* normalisation (phone → 10 digits, "Illinois" → `IL`, `7/4/1990` → ISO). Shared by the API and the agent tools. |
| **SQLite (better-sqlite3)** | Zero-ops persistence that survives restarts when the file is on a volume. CHECK constraints enforce the data model at the DB layer too. Swapping to Postgres is a repository-level change. |
| **pino** | Structured JSON logs; the final collected payload and every tool result go to stdout. |
| **Vitest** | 35 unit + integration tests in under a second. |

---

## Quick start (local)

Requirements: Node 20+ (tested on 22).

```bash
npm install
cp .env.example .env        # defaults work out of the box for local API testing
npm run dev                  # http://localhost:4710
```

On first boot the database is created at `./data/patients.db` and seeded with two fictional patients.

```bash
curl -s localhost:4710/patients | jq
curl -s -X POST localhost:4710/patients -H 'content-type: application/json' -d '{
  "first_name":"Sarah","last_name":"Davis","date_of_birth":"07/04/1990","sex":"Female",
  "phone_number":"(312) 555-0188","address_line_1":"15 Main St","city":"Chicago","state":"Illinois","zip_code":"60601"
}' | jq
open http://localhost:4710/            # landing page
open http://localhost:4710/dashboard/  # patient registry
```

### Talk to the agent without a phone

The simulator runs the exact same prompt and tools against your local database using OpenAI directly:

```bash
OPENAI_API_KEY=sk-... npm run simulate
# or replay a scripted caller:
OPENAI_API_KEY=sk-... npm run simulate -- --script scripts/sample-call.txt
```

---

## Go live (phone number)

1. Deploy the service (see [Deployment](#deployment)) or expose it locally: `ngrok http 4710`.
2. Set in your environment:
   - `PUBLIC_BASE_URL` — the public https URL (e.g. `https://abc123.ngrok-free.app`)
   - `VAPI_API_KEY` — from [dashboard.vapi.ai](https://dashboard.vapi.ai) → Organization → API Keys
   - `VAPI_SERVER_SECRET` — any random string (`openssl rand -hex 24`); Vapi sends it back in `x-vapi-secret` on every webhook and the server rejects anything else with 401.
3. Provision the assistant and a free U.S. number:

```bash
npm run vapi:provision
# Created assistant 4f1c...-...
# Provisioning complete.
#   Phone number : +1 (xxx) xxx-xxxx
#   Webhook URL  : https://.../voice/vapi/webhook
```

Free Vapi numbers need an area code and stock varies; the script starts with `VAPI_AREA_CODE` (default 415) and automatically follows Vapi's "try one of …" hint when that code is out of stock. The script is idempotent: it updates the assistant if one with the same name exists and re-attaches the existing number. Put the printed `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID` in `.env` to pin them. Re-run after any prompt change.

To inspect the exact assistant configuration without calling Vapi: `npm run vapi:print-config`.

> Vapi's built-in OpenAI/Deepgram/ElevenLabs keys are used by default (billed to the Vapi account). You can attach your own provider keys in the Vapi dashboard; no code change needed.

### I don't have a U.S. phone number / I'm not in the U.S.

You do not need to own a number. The number is issued by the provider and attached to the assistant:

| Situation | What to do |
|---|---|
| You just need the U.S. number for reviewers to call | `npm run vapi:provision` requests a **free Vapi U.S. number**. Vapi requires a verified organisation (add a card in the Vapi dashboard; the trial credit covers the demo). |
| Vapi refuses to issue a free number | Buy a U.S. number on **Twilio** (Twilio sells U.S. numbers to accounts in any country, roughly $1/month). Put `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER=+1XXXXXXXXXX` in `.env` and re-run `npm run vapi:provision`; the script imports the number into Vapi and attaches the assistant. The script prints these options if the free-number request fails. |
| You cannot dial a U.S. number from your own phone to test | Use the **browser call**: set `VAPI_PUBLIC_KEY` (Vapi dashboard → API Keys → *Public* key) and `VAPI_ASSISTANT_ID` in `.env`, restart, open `/` or `/dashboard/` and click **Talk to Maya**. It is the same assistant, same prompt, same webhooks; the live transcript is shown and the record appears in the dashboard when the call ends. Only the public key is exposed to the browser. |
| No Vapi account at all | `npm run simulate` runs the identical prompt and tools in the terminal using your `OPENAI_API_KEY`. |

Reviewers in the U.S. can call the provisioned number normally; international callers may be blocked by Vapi's free numbers (they are domestic-only), which is another reason to keep the browser call enabled on the deployed dashboard.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `4710` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind address |
| `NODE_ENV` | no | `development` | `development` enables pretty logs |
| `LOG_LEVEL` | no | `info` | pino level |
| `PUBLIC_BASE_URL` | for voice | — | Public https origin Vapi can reach |
| `DATABASE_PATH` | no | `./data/patients.db` | SQLite file (use a persistent volume in prod) |
| `SEED_ON_BOOT` | no | `true` | Insert 2 demo patients when the table is empty |
| `VAPI_API_KEY` | for provisioning | — | Vapi private key (never shipped to the client) |
| `VAPI_SERVER_SECRET` | yes in prod | `change-me` | Shared secret verified on every webhook |
| `VAPI_ASSISTANT_ID` | no | — | Pin an existing assistant |
| `VAPI_PHONE_NUMBER_ID` | no | — | Pin an existing number |
| `VAPI_AREA_CODE` | no | — | Preferred area code for a new free number |
| `VAPI_PUBLIC_KEY` | for browser calls | — | Vapi *public* key; enables "Talk to the agent" on the dashboard |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | optional | — | Import a Twilio U.S. number into Vapi instead of a free Vapi number |
| `OPENAI_API_KEY` | simulator only | — | Used by `npm run simulate` |
| `OPENAI_MODEL` | no | `gpt-4o` | Model for the assistant and simulator |

No secrets are hardcoded; `.env` is git-ignored.

---

## REST API

All responses use the envelope `{ "data": ..., "error": null }` or `{ "data": null, "error": { "code", "message", ...details } }`.

| Method | Path | Description | Success |
|---|---|---|---|
| `GET` | `/patients` | List patients. Filters: `?last_name=` (case-insensitive exact), `?date_of_birth=MM/DD/YYYY`, `?phone_number=` (any format), `?include_deleted=true`, `?limit=`, `?offset=`. Adds `meta: { total, count }`. | 200 |
| `GET` | `/patients/:id` | Fetch one patient by UUID | 200 |
| `POST` | `/patients` | Create a patient | 201 |
| `PUT` | `/patients/:id` | Partial update (any subset of fields) | 200 |
| `DELETE` | `/patients/:id` | Soft delete (`deleted_at` set; row retained) | 200 |
| `GET` | `/patients/:id/calls` | Call transcripts linked to the patient | 200 |
| `GET` | `/patients/:id/appointments` | Mock appointments | 200 |
| `GET` | `/calls` | Recent calls | 200 |
| `GET` | `/health` | Liveness | 200 |
| `GET` | `/voice/vapi/web-config` | Public key + assistant id for browser calls (or `enabled:false`) | 200 |
| `POST` | `/voice/vapi/webhook` | Vapi server URL (requires `x-vapi-secret`) | 200 |

Status codes: `400` malformed JSON / non-UUID id · `404` unknown or deleted patient · `413` body > 256 KB · `422` validation failure with per-field messages · `500` unexpected error (no stack traces leak).

Example 422:

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {
      "date_of_birth": "cannot be in the future",
      "phone_number": "must be a valid 10-digit U.S. phone number"
    }
  }
}
```

Input sanitisation: strict schemas reject unknown keys, strings are trimmed, all SQL is parameterised, body size is capped.

---

## Data model

Table `patients` (`src/db/schema.sql`), constraints enforced both in Zod and SQLite `CHECK`s:

| Field | Type | Rule | Required |
|---|---|---|---|
| `patient_id` | TEXT (UUID v4) | PK, auto | auto |
| `first_name`, `last_name` | TEXT | 1–50, letters/space/hyphen/apostrophe (Unicode) | yes |
| `date_of_birth` | TEXT ISO date | valid, not future, ≥ 1900; API I/O in `MM/DD/YYYY` | yes |
| `sex` | TEXT enum | `Male`, `Female`, `Other`, `Decline to Answer` | yes |
| `phone_number` | TEXT | exactly 10 digits (NANP-valid), normalised | yes |
| `email` | TEXT | RFC-ish email, lower-cased | no |
| `address_line_1` | TEXT | 1–200 | yes |
| `address_line_2` | TEXT | ≤ 200 | no |
| `city` | TEXT | 1–100 | yes |
| `state` | TEXT | 2-letter US abbreviation (full names accepted and converted) | yes |
| `zip_code` | TEXT | `12345` or `12345-6789` | yes |
| `insurance_provider` | TEXT | ≤ 100 | no |
| `insurance_member_id` | TEXT | alphanumeric, upper-cased | no |
| `preferred_language` | TEXT | default `English` | no |
| `emergency_contact_name` | TEXT | name rules | no |
| `emergency_contact_phone` | TEXT | 10 digits | no |
| `created_at`, `updated_at` | TEXT ISO UTC | auto; `updated_at` maintained by trigger | auto |
| `deleted_at` | TEXT ISO UTC | soft delete | — |

Also: `call_logs` (one per call: status, outcome, transcript, summary, final payload, linked `patient_id`) and `appointments` (mock scheduling). Partial indexes on phone, lower(last_name) and DOB cover the API filters and duplicate detection.

---

## The voice agent

The full system prompt, with a design-notes header explaining each decision, is in [`src/voice/prompt.ts`](src/voice/prompt.ts). Tool contracts are in [`src/voice/tools.ts`](src/voice/tools.ts). Highlights:

- **Persona**: "Maya", intake coordinator at a fictional clinic. Short turns, one question at a time, spoken-number formatting, no lists (TTS reads markdown literally).
- **Validate as you go**: `validate_field` after every answer. The backend returns `say`, the exact re-prompt sentence, so error handling is deterministic and identical to the API's rules.
- **Spell-back** for names; corrections ("D-A-V-I-S, not D-A-V-I-E-S") replace the value and are re-validated.
- **Out-of-order answers** are accepted; the agent captures what it hears and returns to what is missing.
- **Optional opt-in** uses the exact sentence from the brief.
- **Confirmation gate**: `save_patient` is only permitted after a full read-back and explicit confirmation.
- **Duplicate detection** (bonus): `lookup_patient_by_phone` → "It looks like we already have a record for Jane Doe. Would you like to update your information instead?" The executor also guards server-side: a `save_patient` with a known phone becomes an update rather than a duplicate row.
- **Honest failures**: write-tool errors return a spoken apology and offer to retry; the model is instructed never to claim success without a successful tool result. Vapi `request-start` / `request-failed` messages cover slow or unreachable backends so there is never dead air.
- **Start over** wipes collected state and restarts from the name.
- **Spanish** (bonus): multilingual transcription + prompt instruction to switch languages while keeping tool arguments in canonical English formats.
- **Appointment offer** (bonus): three generated slots after a successful save.

---

## Edge cases and resilience

| Scenario | Behaviour |
|---|---|
| Invalid DOB (future / Feb 30 / "yesterday") | `validate_field` → re-prompt only for DOB with an example format |
| 3-digit or 11-digit phone | Re-prompt "I need a ten-digit U.S. phone number, area code first…" |
| State said as a name ("Illinois") | Normalised to `IL` |
| Caller gives several fields at once | Model validates each, continues with what is missing |
| Correction mid-call | Field replaced and re-validated; only that field re-confirmed |
| "Start over" | State discarded, conversation restarts |
| Returning caller | Duplicate detected by phone; update path offered |
| DB write fails | Tool returns `ok:false` + spoken apology/retry offer; nothing saved; logged with stack trace |
| Telephony drops mid-call | `status-update: ended` marks the call `dropped` in `call_logs`; nothing partial is persisted because writes only happen after confirmation; the end-of-call report still stores the transcript |
| Webhook without/with wrong secret | 401 |
| Vapi payload shape differences | `normaliseToolCalls` handles flat and nested `function` shapes and stringified arguments |
| Model hang | Vapi `hang` event logged; Vapi speaks the configured failure message |
| Silence | 30-second silence timeout; prompt instructs a single "Are you still there?" check-in first |
| Server restart | SQLite file on disk; schema migration is idempotent; seeding only runs on an empty table |

---

## Testing

```bash
npm test          # 35 tests: validation, REST API (via fastify.inject), tool executor, webhook
npm run typecheck
```

Coverage of note: 201/400/404/422 paths, filters, partial update, soft delete visibility, duplicate detection, invalid DOB and short phone re-prompts, simulated database failure producing a spoken error, end-of-call transcript storage, dropped-call marking, webhook auth.

---

## Deployment

The app is a single container with a SQLite file; mount a volume at `/data`.

**Railway** (recommended): create a project from this repo (the `Dockerfile` and `railway.json` are picked up), add a volume mounted at `/data`, set `PUBLIC_BASE_URL`, `VAPI_API_KEY`, `VAPI_SERVER_SECRET`. Then run `npm run vapi:provision` from your machine with the same env vars.

**Render**: `render.yaml` defines the service with a 1 GB disk; set the two secret env vars in the dashboard.

**Fly.io**: `fly launch --dockerfile Dockerfile`, `fly volumes create patient_data`, mount at `/data`.

**Docker anywhere**:

```bash
docker compose up --build       # uses .env, persists to the patient-data volume
```

**Local + ngrok** (fastest for a demo):

```bash
npm run dev
ngrok http 4710
PUBLIC_BASE_URL=https://<id>.ngrok-free.app VAPI_API_KEY=... VAPI_SERVER_SECRET=... npm run vapi:provision
```

---

## Project layout

```
src/
  server.ts                 entrypoint, graceful shutdown
  app.ts                    Fastify factory, DI context, error → envelope mapping
  config.ts                 env parsing (Zod)
  db/schema.sql             tables, CHECK constraints, indexes, updated_at trigger
  db/connection.ts          open + migrate
  db/seed.ts                2 demo patients (idempotent)
  lib/errors.ts             AppError / ValidationError / NotFoundError
  patients/schema.ts        validation + normalisation (shared by API and agent)
  patients/repository.ts    SQL
  patients/service.ts       business rules, logging
  patients/routes.ts        REST handlers
  calls/repository.ts       call_logs (transcripts, outcomes)
  appointments/service.ts   mock slots + booking
  voice/prompt.ts           system prompt with design notes
  voice/tools.ts            tool JSON schemas
  voice/toolExecutor.ts     tool dispatch → services; spoken error messages
  voice/vapi/assistant.ts   Vapi assistant config (model, transcriber, voice, timeouts)
  voice/vapi/routes.ts      webhook (auth, tool-calls, status, end-of-call-report)
  voice/vapi/provision.ts   create/update assistant + free number
  simulator/cli.ts          terminal conversation with the same prompt/tools
public/                     landing page, dashboard, Maya illustration (no build step)
  index.html                animated landing page
  landing.css / landing.js
  dashboard/                patient registry UI
  shared/                   design tokens + browser-call widget
  assets/maya.png           cartoon of Maya
tests/                      vitest suites
scripts/sample-call.txt     scripted caller for the simulator
```

---

## Trade-offs and known limitations

- **Vapi dependency**: STT/TTS/turn-taking quality and the phone number itself live in Vapi. This was a deliberate trade for a reliable, low-latency voice experience inside the time limit. The webhook contract is thin, so swapping providers is contained to `src/voice/<provider>/`.
- **SQLite**: single-writer, file-based. Perfect for this scope and for "data must survive restarts" when on a volume; not for multi-instance horizontal scaling. Repository methods are the only SQL, so moving to Postgres is mechanical.
- **No authentication on the REST API** beyond CORS and input validation; the brief did not ask for it and the data is fictional. Add an API key or OAuth before any real use.
- **Conversation state lives in the LLM context**, not in our database, until the caller confirms. That keeps the design simple and avoids half-written rows, but a very long call could exceed context; `maxDurationSeconds` (15 min) bounds this.
- **Duplicate detection is phone-based only**; two household members sharing a number will trigger the prompt (the agent then asks and proceeds as a new registration if it is not them).
- **Appointment scheduling is mock data** generated from the current date; no real calendar.
- **Spanish support** relies on the model and multilingual STT; spoken re-prompt strings from the backend are English and the model is asked to translate them.
- **Not HIPAA-compliant** by design of the assessment; transcripts are stored in plain text.

## Next steps

1. Live-call tuning pass: adjust `startSpeakingPlan` / `stopSpeakingPlan` after listening to a few real calls; add Vapi's call recording URL to `call_logs`.
2. API auth (bearer key) and rate limiting on the public endpoints.
3. Localised re-prompt strings (English/Spanish) returned from the backend based on a `language` hint from the model.
4. Postgres adapter + migrations (node-pg-migrate) for multi-instance deploys.
5. Retell adapter to demonstrate the provider abstraction.
6. End-to-end test of the webhook contract using recorded Vapi payloads.
