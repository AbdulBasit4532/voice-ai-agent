import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp, VALID_PATIENT } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await testApp());
});
afterAll(async () => {
  await app.close();
});

const json = (res: { body: string }) => JSON.parse(res.body);

describe("REST API /patients", () => {
  let id: string;

  it("POST /patients creates a patient (201) with normalised fields and envelope", async () => {
    const res = await app.inject({ method: "POST", url: "/patients", payload: VALID_PATIENT });
    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body.error).toBeNull();
    expect(body.data.patient_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.phone_number).toBe("3125550188");
    expect(body.data.date_of_birth).toBe("07/04/1990");
    expect(body.data.created_at).toMatch(/Z$/);
    id = body.data.patient_id;
  });

  it("POST /patients returns 422 with field errors for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/patients",
      payload: { ...VALID_PATIENT, phone_number: "123", date_of_birth: "01/01/2999", zip_code: "1" },
    });
    expect(res.statusCode).toBe(422);
    const body = json(res);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields).sort()).toEqual(["date_of_birth", "phone_number", "zip_code"]);
  });

  it("POST /patients returns 400 on malformed JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/patients",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("BAD_REQUEST");
  });

  it("GET /patients lists and filters", async () => {
    await app.inject({ method: "POST", url: "/patients", payload: { ...VALID_PATIENT, last_name: "Nguyen", phone_number: "4155550100" } });

    const all = json(await app.inject({ method: "GET", url: "/patients" }));
    expect(all.data.length).toBe(2);
    expect(all.meta.total).toBe(2);

    const byName = json(await app.inject({ method: "GET", url: "/patients?last_name=davis" }));
    expect(byName.data.map((p: { last_name: string }) => p.last_name)).toEqual(["Davis"]);

    const byPhone = json(await app.inject({ method: "GET", url: "/patients?phone_number=(415)%20555-0100" }));
    expect(byPhone.data[0].last_name).toBe("Nguyen");

    const byDob = json(await app.inject({ method: "GET", url: "/patients?date_of_birth=07/04/1990" }));
    expect(byDob.data.length).toBe(2);

    const badFilter = await app.inject({ method: "GET", url: "/patients?date_of_birth=garbage" });
    expect(badFilter.statusCode).toBe(422);
  });

  it("GET /patients/:id returns the record, 400 for bad id, 404 for unknown", async () => {
    expect((await app.inject({ method: "GET", url: `/patients/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/patients/not-a-uuid" })).statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/patients/00000000-0000-4000-8000-000000000000" });
    expect(missing.statusCode).toBe(404);
    expect(json(missing).error.code).toBe("NOT_FOUND");
  });

  it("PUT /patients/:id applies partial updates and bumps updated_at", async () => {
    const before = json(await app.inject({ method: "GET", url: `/patients/${id}` })).data;
    await new Promise((r) => setTimeout(r, 5));
    const res = await app.inject({ method: "PUT", url: `/patients/${id}`, payload: { email: "Sarah@Example.com", state: "texas" } });
    expect(res.statusCode).toBe(200);
    const after = json(res).data;
    expect(after.email).toBe("sarah@example.com");
    expect(after.state).toBe("TX");
    expect(after.first_name).toBe("Sarah");
    expect(after.updated_at > before.updated_at).toBe(true);

    expect((await app.inject({ method: "PUT", url: `/patients/${id}`, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: "PUT", url: `/patients/${id}`, payload: { phone_number: "12" } })).statusCode).toBe(422);
  });

  it("DELETE /patients/:id soft-deletes (hidden from list, kept in DB)", async () => {
    const res = await app.inject({ method: "DELETE", url: `/patients/${id}` });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/patients/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/patients/${id}` })).statusCode).toBe(404);

    const list = json(await app.inject({ method: "GET", url: "/patients" }));
    expect(list.data.find((p: { patient_id: string }) => p.patient_id === id)).toBeUndefined();

    const withDeleted = json(await app.inject({ method: "GET", url: "/patients?include_deleted=true" }));
    const row = withDeleted.data.find((p: { patient_id: string }) => p.patient_id === id);
    expect(row.deleted_at).toMatch(/Z$/);
  });

  it("unknown routes return the error envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(json(res)).toEqual({ data: null, error: { code: "NOT_FOUND", message: "Route GET /nope not found" } });
  });
});
