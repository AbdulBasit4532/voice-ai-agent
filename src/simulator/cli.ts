/**
 * Local text simulator: the same system prompt and tools as the phone agent, driven by OpenAI
 * directly, with tool calls executed against the local service layer (same SQLite file).
 *
 *   npm run simulate                       # interactive chat in the terminal
 *   npm run simulate -- --script file.txt  # feed caller lines from a file (one per line)
 *
 * Useful for iterating on the prompt and for reviewers without a phone handy.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import pino from "pino";
import { createContext } from "../app.js";
import { config } from "../config.js";
import { FIRST_MESSAGE, SYSTEM_PROMPT } from "../voice/prompt.js";
import { toOpenAiTools } from "../voice/tools.js";

async function main(): Promise<void> {
  if (!config.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required for the simulator.");
    process.exit(1);
  }
  const log = pino({ level: process.env.LOG_LEVEL ?? "warn" });
  const ctx = createContext(config, log);
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const tools = [...toOpenAiTools(), {
    type: "function" as const,
    function: { name: "endCall", description: "Hang up the call.", parameters: { type: "object", properties: {} } },
  }];

  const callId = `sim-${randomUUID()}`;
  ctx.calls.ensure(callId, "simulator", null);
  const transcript: string[] = [];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "assistant", content: FIRST_MESSAGE },
  ];

  const scriptIdx = process.argv.indexOf("--script");
  const scripted = scriptIdx > -1 ? fs.readFileSync(process.argv[scriptIdx + 1], "utf8").split("\n").filter(Boolean) : null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (scripted) {
        const line = scripted.shift();
        if (line === undefined) return resolve(null);
        console.log(`Caller: ${line}`);
        return resolve(line);
      }
      rl.question("Caller: ", (a) => resolve(a));
    });

  const say = (text: string) => {
    console.log(`\nMaya: ${text}\n`);
    transcript.push(`AI: ${text}`);
  };
  say(FIRST_MESSAGE);

  let ended = false;
  while (!ended) {
    const line = await ask();
    if (line === null || line.trim() === "/quit") break;
    transcript.push(`User: ${line}`);
    messages.push({ role: "user", content: line });

    // Loop until the model produces a spoken reply (it may chain several tool calls first).
    for (let hop = 0; hop < 8 && !ended; hop++) {
      const completion = await openai.chat.completions.create({
        model: config.OPENAI_MODEL,
        temperature: 0.3,
        messages,
        tools,
      });
      const msg = completion.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls?.length) {
        if (msg.content) say(msg.content);
        break;
      }
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        if (tc.function.name === "endCall") {
          ended = true;
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: true }) });
          continue;
        }
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* malformed args -> empty */ }
        const result = await ctx.tools.execute({ id: tc.id, name: tc.function.name, arguments: args }, { callId, provider: "simulator" });
        console.log(`  [tool ${tc.function.name}] ${JSON.stringify(result.result)}`);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result.result) });
      }
      if (ended && msg.content) say(msg.content);
    }
  }

  const existing = ctx.calls.get(callId);
  ctx.calls.update(callId, {
    status: "completed",
    transcript: transcript.join("\n"),
    ended_at: new Date().toISOString(),
    outcome: existing?.outcome ?? "abandoned",
  });
  console.log(`\n[call ${callId} ended; transcript stored]`);
  rl.close();
  ctx.db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
