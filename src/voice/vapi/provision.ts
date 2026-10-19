/**
 * Provisions (or updates) the Vapi assistant and a free U.S. phone number.
 *
 *   npm run vapi:provision          # create/update assistant + ensure a number is attached
 *   npm run vapi:print-config       # just print the assistant JSON (no API calls)
 *
 * Requires VAPI_API_KEY, PUBLIC_BASE_URL and VAPI_SERVER_SECRET in the environment.
 * Idempotent: set VAPI_ASSISTANT_ID / VAPI_PHONE_NUMBER_ID to update existing resources.
 */
import { config } from "../../config.js";
import { ASSISTANT_NAME, buildAssistantConfig } from "./assistant.js";

const VAPI_API = "https://api.vapi.ai";

async function vapi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${VAPI_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.VAPI_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Assistant { id: string; name: string }
interface PhoneNumber { id: string; number?: string; assistantId?: string; name?: string; provider?: string }

async function main(): Promise<void> {
  const printOnly = process.argv.includes("--print");
  const publicBaseUrl = config.PUBLIC_BASE_URL ?? "https://example.invalid";
  const assistant = buildAssistantConfig({ publicBaseUrl, serverSecret: config.VAPI_SERVER_SECRET, model: config.OPENAI_MODEL });

  if (printOnly) {
    console.log(JSON.stringify(assistant, null, 2));
    return;
  }
  if (!config.VAPI_API_KEY) throw new Error("VAPI_API_KEY is required");
  if (!config.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required (your public https URL)");
  if (config.VAPI_SERVER_SECRET === "change-me") throw new Error("Set VAPI_SERVER_SECRET to a random value first");

  // 1. Assistant: update if we know the id (or find one by name), otherwise create.
  let assistantId = config.VAPI_ASSISTANT_ID;
  if (!assistantId) {
    const existing = await vapi<Assistant[]>("GET", "/assistant?limit=100");
    assistantId = existing.find((a) => a.name === ASSISTANT_NAME)?.id;
  }
  if (assistantId) {
    await vapi("PATCH", `/assistant/${assistantId}`, assistant);
    console.log(`Updated assistant ${assistantId}`);
  } else {
    const created = await vapi<Assistant>("POST", "/assistant", assistant);
    assistantId = created.id;
    console.log(`Created assistant ${assistantId}`);
  }

  // 2. Phone number. Priority: pinned id -> number already attached -> Twilio import -> free Vapi number.
  //    You do not need to own a U.S. number: Vapi issues free U.S. numbers, and Twilio sells U.S. numbers
  //    to accounts in any country. The number is attached to the assistant either way.
  let number: PhoneNumber | undefined;
  let numberError: string | undefined;
  try {
    if (config.VAPI_PHONE_NUMBER_ID) {
      number = await vapi<PhoneNumber>("PATCH", `/phone-number/${config.VAPI_PHONE_NUMBER_ID}`, { assistantId });
    } else {
      const numbers = await vapi<PhoneNumber[]>("GET", "/phone-number");
      number =
        numbers.find((n) => n.assistantId === assistantId) ??
        numbers.find((n) => n.name === ASSISTANT_NAME) ??
        (config.TWILIO_PHONE_NUMBER ? numbers.find((n) => n.number === config.TWILIO_PHONE_NUMBER) : undefined);
      if (number) {
        number = await vapi<PhoneNumber>("PATCH", `/phone-number/${number.id}`, { assistantId });
      } else if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER) {
        number = await vapi<PhoneNumber>("POST", "/phone-number", {
          provider: "twilio",
          name: ASSISTANT_NAME,
          assistantId,
          number: config.TWILIO_PHONE_NUMBER,
          twilioAccountSid: config.TWILIO_ACCOUNT_SID,
          twilioAuthToken: config.TWILIO_AUTH_TOKEN,
        });
        console.log(`Imported Twilio number ${config.TWILIO_PHONE_NUMBER} into Vapi`);
      } else {
        number = await vapi<PhoneNumber>("POST", "/phone-number", {
          provider: "vapi",
          name: ASSISTANT_NAME,
          assistantId,
          ...(config.VAPI_AREA_CODE ? { numberDesiredAreaCode: config.VAPI_AREA_CODE } : {}),
        });
        console.log("Requested a free Vapi U.S. number");
      }
    }
  } catch (err) {
    numberError = err instanceof Error ? err.message : String(err);
  }

  console.log("");
  console.log(number ? "Provisioning complete." : "Assistant provisioned; phone number NOT attached.");
  console.log(`  Assistant ID : ${assistantId}`);
  if (number) {
    console.log(`  Number ID    : ${number.id}`);
    console.log(`  Phone number : ${number.number ?? "(pending — check the Vapi dashboard)"}`);
  } else {
    console.log(`  Number error : ${numberError}`);
    console.log("");
    console.log("  Options:");
    console.log("   a) Add a payment method in the Vapi dashboard (free numbers require a verified org), then re-run.");
    console.log("   b) Buy a U.S. number on Twilio (available from any country), set TWILIO_ACCOUNT_SID,");
    console.log("      TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER (+1XXXXXXXXXX) in .env, then re-run.");
    console.log("   c) Test without a phone: set VAPI_PUBLIC_KEY in .env and use 'Talk to the agent' on /dashboard,");
    console.log("      or run 'npm run simulate'.");
  }
  console.log(`  Webhook URL  : ${publicBaseUrl.replace(/\/$/, "")}/voice/vapi/webhook`);
  console.log("");
  console.log("Add these to your .env so future runs update instead of create:");
  console.log(`  VAPI_ASSISTANT_ID=${assistantId}`);
  if (number) console.log(`  VAPI_PHONE_NUMBER_ID=${number.id}`);
  if (!config.VAPI_PUBLIC_KEY) console.log("  VAPI_PUBLIC_KEY=<public key from Vapi dashboard>  # enables browser calls");
  if (numberError) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
