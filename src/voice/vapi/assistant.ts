import { CLINIC_NAME, FALLBACK_MESSAGE, FIRST_MESSAGE, SYSTEM_PROMPT } from "../prompt.js";
import { TOOL_DEFINITIONS } from "../tools.js";

export interface VapiAssistantOptions {
  publicBaseUrl: string;
  serverSecret: string;
  model?: string;
}

export const ASSISTANT_NAME = "Patient Registration Intake";

/**
 * Builds the Vapi assistant payload (POST/PATCH /assistant).
 * Vapi hosts the realtime loop (telephony, STT, LLM turn-taking, TTS); every tool call is
 * forwarded to our webhook, which is where validation and persistence happen.
 *
 * Choices:
 * - Deepgram nova-3 with `language: multi` so a caller can switch to Spanish mid-call (bonus).
 * - ElevenLabs turbo v2.5 voice: multilingual and low-latency; Vapi provides built-in credentials.
 * - Temperature 0.3: friendly phrasing but deterministic tool usage.
 * - `silenceTimeoutSeconds` + `maxDurationSeconds` bound the cost of an abandoned call.
 * - Spoken "request-start" filler on write tools so a slow DB never sounds like dead air.
 */
export function buildAssistantConfig(opts: VapiAssistantOptions) {
  const serverUrl = `${opts.publicBaseUrl.replace(/\/$/, "")}/voice/vapi/webhook`;
  const server = { url: serverUrl, secret: opts.serverSecret, timeoutSeconds: 20 };

  const functionTools = TOOL_DEFINITIONS.map((t) => ({
    type: "function",
    async: false,
    server,
    function: { name: t.name, description: t.description, parameters: t.parameters },
    messages: fillerMessages(t.name),
  }));

  return {
    name: ASSISTANT_NAME,
    firstMessage: FIRST_MESSAGE,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: opts.model ?? "gpt-4o",
      temperature: 0.3,
      maxTokens: 250,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: [...functionTools, { type: "endCall" }],
    },
    transcriber: { provider: "deepgram", model: "nova-3", language: "multi", smartFormat: true },
    voice: { provider: "11labs", voiceId: "sarah", model: "eleven_turbo_v2_5", stability: 0.5, similarityBoost: 0.75 },
    server,
    serverMessages: ["tool-calls", "end-of-call-report", "status-update", "hang"],
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    backgroundSound: "off",
    backgroundDenoisingEnabled: true,
    endCallMessage: `Thanks for calling ${CLINIC_NAME}. Take care!`,
    endCallPhrases: ["goodbye", "bye bye", "that's all, thanks"],
    voicemailDetection: { provider: "twilio", enabled: true },
    startSpeakingPlan: { waitSeconds: 0.6, smartEndpointingEnabled: true },
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 },
    analysisPlan: {
      summaryPrompt:
        "Summarize this patient registration call in 2-3 sentences: who called, whether registration was completed, and any issues or corrections.",
      successEvaluationPrompt:
        "Was a patient record successfully saved or updated during this call? Answer true or false.",
      successEvaluationRubric: "PassFail",
    },
    metadata: { app: "voice-patient-registration", fallbackMessage: FALLBACK_MESSAGE },
  };
}

function fillerMessages(toolName: string) {
  if (toolName === "save_patient" || toolName === "update_patient") {
    return [
      { type: "request-start", content: "One moment while I save that.", blocking: false },
      { type: "request-failed", content: "I'm sorry, I couldn't reach our records system just now. Let's try that again in a moment." },
      { type: "request-response-delayed", content: "Still saving, thanks for your patience.", timingMilliseconds: 6000 },
    ];
  }
  if (toolName === "schedule_appointment") {
    return [{ type: "request-start", content: "Booking that for you now.", blocking: false }];
  }
  return [{ type: "request-failed", content: "Sorry, I had a hiccup there. Could you say that once more?" }];
}
