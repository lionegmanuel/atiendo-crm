import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateRequest, validateBody } from "@/lib/schemas/_validate";
import { ApiError } from "@/lib/api/types";

const schema = z.object({ name: z.string().min(1), age: z.number().int().nonnegative() });

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("validateRequest()", () => {
  it("returns parsed for valid body", async () => {
    const req = jsonRequest({ name: "Ada", age: 30 });
    const result = await validateRequest(schema, req);
    expect(result).toEqual({ name: "Ada", age: 30 });
  });

  it("throws ApiError(422, validation_error, fieldErrors)", async () => {
    const req = jsonRequest({ name: "", age: -1 });
    try {
      await validateRequest(schema, req);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(422);
      expect(e.code).toBe("validation_error");
      expect(e.details).toBeTruthy();
      expect(e.details!.fieldErrors).toBeTruthy();
      expect(e.requestId).toBeTruthy();
    }
  });

  it("throws ApiError(400, body_malformed) for non-JSON body", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    try {
      await validateRequest(schema, req);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(400);
      expect(e.code).toBe("body_malformed");
      expect(e.requestId).toBeTruthy();
    }
  });
});

describe("validateBody()", () => {
  it("returns parsed for valid body", () => {
    expect(validateBody(schema, { name: "Ada", age: 30 })).toEqual({ name: "Ada", age: 30 });
  });

  it("throws ApiError(422) for invalid body", () => {
    try {
      validateBody(schema, { name: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(422);
      expect((err as ApiError).requestId).toBeTruthy();
    }
  });
});
