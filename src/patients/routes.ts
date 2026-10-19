import type { FastifyInstance } from "fastify";
import { BadRequestError } from "../lib/errors.js";
import { uuidSchema } from "./schema.js";
import type { AppContext } from "../app.js";

/**
 * REST resource: /patients
 * Every response uses the envelope { data, error }. Errors are produced centrally
 * by the Fastify error handler (see app.ts), so handlers only deal with the happy path.
 */
export async function patientRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { patients, calls, appointments } = ctx;

  const parseId = (raw: string): string => {
    const r = uuidSchema.safeParse(raw);
    if (!r.success) throw new BadRequestError("patient id must be a UUID");
    return r.data;
  };

  app.get("/patients", async (req) => {
    const { items, total } = patients.list(req.query);
    return { data: items, error: null, meta: { total, count: items.length } };
  });

  app.get<{ Params: { id: string } }>("/patients/:id", async (req) => {
    const patient = patients.get(parseId(req.params.id));
    return { data: patient, error: null };
  });

  app.post("/patients", async (req, reply) => {
    if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw new BadRequestError("request body must be a JSON object");
    }
    const created = patients.create(req.body);
    reply.code(201);
    return { data: created, error: null };
  });

  app.put<{ Params: { id: string } }>("/patients/:id", async (req) => {
    if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw new BadRequestError("request body must be a JSON object");
    }
    const updated = patients.update(parseId(req.params.id), req.body);
    return { data: updated, error: null };
  });

  app.delete<{ Params: { id: string } }>("/patients/:id", async (req) => {
    const id = parseId(req.params.id);
    patients.softDelete(id);
    return { data: { patient_id: id, deleted: true }, error: null };
  });

  // Bonus: transcripts and appointments linked to a patient (used by the dashboard).
  app.get<{ Params: { id: string } }>("/patients/:id/calls", async (req) => {
    const id = parseId(req.params.id);
    patients.get(id);
    return { data: calls.listForPatient(id), error: null };
  });

  app.get<{ Params: { id: string } }>("/patients/:id/appointments", async (req) => {
    const id = parseId(req.params.id);
    patients.get(id);
    return { data: appointments.listForPatient(id), error: null };
  });

  app.get("/calls", async () => {
    return { data: calls.listRecent(100), error: null };
  });
}
