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

  // 2. Phone number: reuse configured/attached number, otherwise request a free Vapi number.
  let number: PhoneNumber | undefined;
  if (config.VAPI_PHONE_NUMBER_ID) {
    number = await vapi<PhoneNumber>("PATCH", `/phone-number/${config.VAPI_PHONE_NUMBER_ID}`, { assistantId });
  } else {
    const numbers = await vapi<PhoneNumber[]>("GET", "/phone-number");
    number = numbers.find((n) => n.assistantId === assistantId) ?? numbers.find((n) => n.name === ASSISTANT_NAME);
    if (number) {
      number = await vapi<PhoneNumber>("PATCH", `/phone-number/${number.id}`, { assistantId });
    } else {
      number = await vapi<PhoneNumber>("POST", "/phone-number", {
        provider: "vapi",
        name: ASSISTANT_NAME,
        assistantId,
        ...(config.VAPI_AREA_CODE ? { numberDesiredAreaCode: config.VAPI_AREA_CODE } : {}),
      });
    }
  }

  console.log("");
  console.log("Provisioning complete.");
  console.log(`  Assistant ID : ${assistantId}`);
  console.log(`  Number ID    : ${number.id}`);
  console.log(`  Phone number : ${number.number ?? "(pending — check the Vapi dashboard)"}`);
  console.log(`  Webhook URL  : ${publicBaseUrl.replace(/\/$/, "")}/voice/vapi/webhook`);
  console.log("");
  console.log("Add these to your .env so future runs update instead of create:");
  console.log(`  VAPI_ASSISTANT_ID=${assistantId}`);
  console.log(`  VAPI_PHONE_NUMBER_ID=${number.id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
