import "dotenv/config";
import { z } from "zod";

/**
 * All runtime configuration comes from environment variables.
 * Nothing secret is hardcoded; see .env.example for documentation.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4710),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  PUBLIC_BASE_URL: z.string().url().optional(),

  DATABASE_PATH: z.string().default("./data/patients.db"),
  SEED_ON_BOOT: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),

  VAPI_API_KEY: z.string().optional(),
  VAPI_SERVER_SECRET: z.string().min(1).default("change-me"),
  VAPI_ASSISTANT_ID: z.string().optional(),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_AREA_CODE: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
