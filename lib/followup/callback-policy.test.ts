import { describe, expect, it } from "vitest";

import {
  callbacksHabilitados,
  filtrarToolsComCallbackDesabilitado,
  podeExporScheduleFollowup,
} from "./callback-policy";

describe("política de criação de retornos pelo agente", () => {
  it.each([
    [undefined, true],
    [{ enabled: false, flow_pointer_ids: [] }, true],
    [{ callback_enabled: true }, true],
    [{ callback_enabled: false }, false],
    [null, true],
    ["inválido", true],
  ])("interpreta %j como callback_enabled=%s", (followup, esperado) => {
    expect(callbacksHabilitados(followup)).toBe(esperado);
  });

  it("só oferece schedule_followup quando há knobs e callbacks estão habilitados", () => {
    const knobs = { minAheadMs: 60_000 };
    expect(podeExporScheduleFollowup(undefined, knobs)).toBe(true);
    expect(podeExporScheduleFollowup({ callback_enabled: true }, knobs)).toBe(true);
    expect(podeExporScheduleFollowup({ callback_enabled: false }, knobs)).toBe(false);
    expect(podeExporScheduleFollowup(undefined, undefined)).toBe(false);
  });

  it("remove somente a ferramenta MCP que cria retorno; mantém leitura, cancelamento, fluxos e agenda", () => {
    const ids = [
      "crm_schedule_followup",
      "crm_list_followups",
      "crm_cancel_followup",
      "crm_enroll_followup_flow",
      "crm_propose_reactivation",
      "crm_book_appointment",
      "crm_find_and_book_appointment",
    ];

    expect(filtrarToolsComCallbackDesabilitado(ids, { callback_enabled: false })).toEqual([
      "crm_list_followups",
      "crm_cancel_followup",
      "crm_enroll_followup_flow",
      "crm_propose_reactivation",
      "crm_book_appointment",
      "crm_find_and_book_appointment",
    ]);
    expect(filtrarToolsComCallbackDesabilitado(ids, undefined)).toEqual(ids);
    expect(filtrarToolsComCallbackDesabilitado(ids, { callback_enabled: true })).toEqual(ids);
  });
});
