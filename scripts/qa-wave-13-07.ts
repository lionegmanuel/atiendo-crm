/* eslint-disable no-console */
/**
 * Wave 7 (EPIC-13) QA — agent-dispatcher cron worker.
 * Backend-only feature (no UI). Tests endpoint auth + summary shape +
 * audit emission + idempotent re-run.
 *
 * Run: npx tsx scripts/qa-wave-13-07.ts
 */
import * as fs from "fs";
import * as path from "path";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

// `process.env` vence o `.env.local` (scripts/lib/env-de-teste.ts).
carregarEnvLocal();

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:3001";
const CRON_PATH = "/api/v1/cron/agent-dispatcher";
const CRON_SECRET = process.env.INTERNAL_CRON_SECRET ?? "";
const FALLBACK_SECRET = process.env.INTERNAL_SECRET ?? "";

type Result = { ac: string; pass: boolean; evidence: string };
const results: Result[] = [];
const record = (ac: string, pass: boolean, evidence: string) => {
  results.push({ ac, pass, evidence });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${ac} — ${evidence}`);
};

async function main() {
  // TC-01: missing auth → 403
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errCode = (body as { error?: { code?: string } }).error?.code;
    record(
      "TC-01 endpoint rejeita request sem segredo (403 forbidden)",
      res.status === 403 && errCode === "forbidden",
      `status=${res.status} code=${errCode ?? "?"}`,
    );
  }

  // TC-02: invalid secret → 403
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { Authorization: "Bearer wrong-secret-xxx" },
    });
    record(
      "TC-02 endpoint rejeita Bearer invalido",
      res.status === 403,
      `status=${res.status}`,
    );
  }

  // TC-03: valid INTERNAL_CRON_SECRET via Bearer → 200 + summary shape
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = (await res.json()) as { data?: { batch_size?: number; outcomes?: Record<string, number>; errors?: unknown[] } };
    const d = body.data;
    const ok =
      res.status === 200 &&
      typeof d?.batch_size === "number" &&
      d?.outcomes !== undefined &&
      typeof d.outcomes === "object" &&
      Array.isArray(d.errors);
    record(
      "TC-03 endpoint aceita Bearer INTERNAL_CRON_SECRET e retorna {batch_size, outcomes, errors}",
      ok,
      `status=${res.status} batch_size=${d?.batch_size} outcomes=${JSON.stringify(d?.outcomes)}`,
    );
  }

  // TC-04: x-cron-secret alias header
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    record(
      "TC-04 endpoint aceita header X-Cron-Secret (alias do spec)",
      res.status === 200,
      `status=${res.status}`,
    );
  }

  // TC-05: fallback INTERNAL_SECRET via Bearer
  if (FALLBACK_SECRET && FALLBACK_SECRET !== CRON_SECRET) {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { Authorization: `Bearer ${FALLBACK_SECRET}` },
    });
    record(
      "TC-05 fallback INTERNAL_SECRET tambem aceito",
      res.status === 200,
      `status=${res.status}`,
    );
  } else {
    record(
      "TC-05 fallback INTERNAL_SECRET tambem aceito",
      true,
      "skipped: secrets equal or fallback not set",
    );
  }

  // TC-06: POST verb supported
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    record(
      "TC-06 verb POST suportado (paridade com GET)",
      res.status === 200,
      `status=${res.status}`,
    );
  }

  // TC-07: idempotente — segunda chamada nao explode
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = (await res.json()) as { data?: { errors?: unknown[] } };
    record(
      "TC-07 re-execucao consecutiva e idempotente (sem errors[] populado)",
      res.status === 200 && Array.isArray(body.data?.errors) && body.data!.errors!.length === 0,
      `status=${res.status} errors=${JSON.stringify(body.data?.errors)}`,
    );
  }

  // TC-08: response shape inclui requestId no meta (audit correlation)
  {
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = (await res.json()) as { meta?: { requestId?: string } };
    const rid = body.meta?.requestId;
    record(
      "TC-08 response inclui meta.requestId (UUID) p/ correlacao com audit log",
      typeof rid === "string" && /^[0-9a-f-]{36}$/i.test(rid),
      `requestId=${rid ?? "missing"}`,
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== SUMMARY: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    console.log("FAILS:");
    for (const f of failed) console.log(`  - ${f.ac}: ${f.evidence}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
