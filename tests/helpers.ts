import pino from "pino";
import { buildApp, createContext, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/config.js";

export const VALID_PATIENT = {
  first_name: "Sarah",
  last_name: "Davis",
  date_of_birth: "07/04/1990",
  sex: "Female",
  phone_number: "(312) 555-0188",
  address_line_1: "1 Main St",
  city: "Chicago",
  state: "IL",
  zip_code: "60601",
};

export function testContext(): AppContext {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    SEED_ON_BOOT: "false",
    VAPI_SERVER_SECRET: "test-secret",
    LOG_LEVEL: "silent",
  });
  return createContext(config, pino({ level: "silent" }));
}

export async function testApp() {
  const ctx = testContext();
  const app = await buildApp(ctx);
  await app.ready();
  return { app, ctx };
}
