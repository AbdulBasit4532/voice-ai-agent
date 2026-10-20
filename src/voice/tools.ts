/**
 * Tool (function-calling) definitions shared by the Vapi assistant and the local simulator.
 * They are plain JSON Schema so the same object can be handed to any LLM provider.
 *
 * Keep descriptions short and imperative: they are part of the prompt budget on every turn.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const PATIENT_PROPERTIES = {
  first_name: { type: "string", description: "Legal first name" },
  last_name: { type: "string", description: "Legal last name" },
  date_of_birth: { type: "string", description: "MM/DD/YYYY" },
  sex: { type: "string", enum: ["Male", "Female", "Other", "Decline to Answer"] },
  phone_number: { type: "string", description: "10 digits, no punctuation" },
  email: { type: "string" },
  address_line_1: { type: "string", description: "Street address" },
  address_line_2: { type: "string", description: "Apt, suite or unit" },
  city: { type: "string" },
  state: { type: "string", description: "2-letter U.S. state abbreviation" },
  zip_code: { type: "string", description: "12345 or 12345-6789" },
  insurance_provider: { type: "string" },
  insurance_member_id: { type: "string" },
  preferred_language: { type: "string" },
  emergency_contact_name: { type: "string" },
  emergency_contact_phone: { type: "string", description: "10 digits" },
} as const;

export const PATIENT_FIELD_NAMES = Object.keys(PATIENT_PROPERTIES);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "validate_field",
    description:
      "Validate ONE patient field the caller just provided. Call this after every answer. Returns ok:true with the normalised value, or ok:false with the exact sentence to say when re-asking.",
    parameters: {
      type: "object",
      properties: {
        field: { type: "string", enum: PATIENT_FIELD_NAMES },
        value: { type: "string", description: "What the caller said, as text" },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "lookup_patient_by_phone",
    description:
      "Check whether a patient with this phone number is already registered. Call as soon as you have the caller's phone number.",
    parameters: {
      type: "object",
      properties: { phone_number: { type: "string", description: "10 digits" } },
      required: ["phone_number"],
    },
  },
  {
    name: "save_patient",
    description:
      "Create a brand-new patient record. Call ONLY after the caller has heard the full read-back and confirmed it is correct. Always use this for a new patient, even if their phone number was already on file for someone else.",
    parameters: {
      type: "object",
      properties: PATIENT_PROPERTIES,
      required: ["first_name", "last_name", "date_of_birth", "sex", "phone_number", "address_line_1", "city", "state", "zip_code"],
    },
  },
  {
    name: "update_patient",
    description:
      "Update an existing patient (returning caller) with the fields that changed. Call ONLY when lookup_patient_by_phone matched AND the caller explicitly said yes to updating that existing record.",
    parameters: {
      type: "object",
      properties: { patient_id: { type: "string" }, ...PATIENT_PROPERTIES },
      required: ["patient_id"],
    },
  },
  {
    name: "get_appointment_slots",
    description: "Get up to three available first-appointment slots to offer the caller after registration.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "schedule_appointment",
    description: "Book one of the offered appointment slots for the registered patient.",
    parameters: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        slot_id: { type: "string", description: "slot_id from get_appointment_slots" },
        reason: { type: "string", description: "Optional reason for visit" },
      },
      required: ["patient_id", "slot_id"],
    },
  },
  {
    name: "log_call_outcome",
    description:
      "Record that the call ended without a saved record (caller hung up, refused, or asked to stop). Call before end_call when registration was NOT completed.",
    parameters: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["abandoned", "declined", "not_a_new_patient"] },
        note: { type: "string" },
      },
      required: ["outcome"],
    },
  },
];

/** OpenAI chat-completions format (used by the simulator). */
export function toOpenAiTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
