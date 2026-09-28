import type { ZodError, ZodSchema } from "zod";
import { ApiError } from "@/lib/api/types";

function toFieldErrors(err: ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

export async function validateRequest<T>(schema: ZodSchema<T>, request: Request): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "body_malformed", undefined, crypto.randomUUID(), "Body must be valid JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      { fieldErrors: toFieldErrors(parsed.error) },
      crypto.randomUUID(),
      "Validation failed",
    );
  }
  return parsed.data;
}

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      { fieldErrors: toFieldErrors(parsed.error) },
      crypto.randomUUID(),
      "Validation failed",
    );
  }
  return parsed.data;
}
