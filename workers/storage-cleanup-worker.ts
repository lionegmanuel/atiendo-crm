/**
 * Storage cleanup worker — drains `storage_redaction_queue`.
 *
 * Producer: `fn_lgpd_cascade_redact_contact` (during LGPD redact cascade).
 * Driver: cron route at `app/api/v1/cron/storage-redaction/route.ts`.
 *
 * Idempotent. Caller controls batch size; failures are retried up to 3 times
 * before transitioning to terminal `failed`.
 */

export {
  drainStorageRedactionQueue,
  type DrainStats,
} from "@/lib/lgpd/storage-redaction-queue";
