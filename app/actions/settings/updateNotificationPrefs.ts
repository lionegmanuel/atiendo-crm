"use server";

import { notificationPrefsSchema, type NotificationPrefsInput } from "@/lib/schemas/settings";

export type UpdateNotificationPrefsResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

/**
 * STUB — `notification_prefs` table is not yet migrated. Wave 5 of EPIC-10
 * ships UI only. When the table exists, replace this body with a real upsert.
 */
export async function updateNotificationPrefs(
  input: NotificationPrefsInput,
): Promise<UpdateNotificationPrefsResult> {
  const parsed = notificationPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }
  return { ok: false, error: "feature_not_yet_available" };
}
