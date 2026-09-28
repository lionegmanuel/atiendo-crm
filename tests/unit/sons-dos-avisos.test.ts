/**
 * Os sons dos avisos da Central: qual aviso toca qual som, que só aviso NOVO
 * toca, e que o arquivo é reconhecido pelos bytes (não pela extensão).
 *
 * O caso que a primeira versão errava: `kind = 'other'` com `ref_kind = 'lead'`
 * também é o aviso do espelho de etapa que o assistente não conseguiu gravar
 * (`abreAvisoDoEspelhoRecusado`). Um defeito de funil não pode tocar o som de
 * "entrou na etapa" — o reconhecimento é pelo título que `tituloDoAvisoDeEtapa`
 * monta, em qualquer idioma servido.
 */
import { describe, expect, it } from "vitest";

import { avisoDoEspelhoRecusado, type MirrorReason } from "@/lib/agent-engine/edge/crm/move-lead-stage";
import { ehAvisoDeEtapa, tituloDoAvisoDeEtapa } from "@/lib/leads/aviso-de-etapa";
import { IDIOMAS } from "@/lib/i18n/idiomas";
import { farejarAudio, somDoAviso, sonsNovos } from "@/lib/notifications/sons-da-org";

const bytes = (...partes: (string | number[])[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(Array(16).fill(0)));

const avisoDeEtapa = (idioma: (typeof IDIOMAS)[number]) => ({
  kind: "other",
  ref_kind: "lead",
  title: tituloDoAvisoDeEtapa("Pedido confirmado", idioma),
});

describe("qual som cada aviso pede", () => {
  it("pedido de pessoa → som de pessoa; negócio na etapa que avisa → som da etapa", () => {
    expect(somDoAviso({ kind: "handoff", ref_kind: "conversation" })).toBe("pessoa");
    expect(somDoAviso(avisoDeEtapa("pt-BR"))).toBe("venda");
    expect(somDoAviso({ kind: "job_dead", ref_kind: "conversation" })).toBeNull();
    expect(somDoAviso({ kind: "other", ref_kind: "channel_session" })).toBeNull();
  });

  it("o aviso de etapa é reconhecido em todo idioma servido", () => {
    expect(IDIOMAS.length).toBeGreaterThan(1);
    for (const idioma of IDIOMAS) {
      expect(ehAvisoDeEtapa(avisoDeEtapa(idioma)), idioma).toBe(true);
      expect(somDoAviso(avisoDeEtapa(idioma)), idioma).toBe("venda");
    }
  });

  it("o aviso do espelho recusado (também `other` + negócio) NÃO toca o som da etapa", () => {
    // TODOS os motivos: os warn-only devolvem `null` e não entram na conta.
    const motivos: MirrorReason[] = [
      "not_configured",
      "human_conflict",
      "fora_do_escopo",
      "perda_sem_motivo",
      "campos_obrigatorios",
      "crm_error",
      "crm_unavailable",
    ];
    let medidos = 0;
    for (const motivo of motivos) {
      const aviso = avisoDoEspelhoRecusado({ motivo, detalhe: "detalhe", etapaDeDestino: "Pedido confirmado" });
      if (!aviso) continue;
      medidos += 1;
      const item = { kind: "other", ref_kind: "lead", title: aviso.title };
      expect(ehAvisoDeEtapa(item), aviso.title).toBe(false);
      expect(somDoAviso(item), aviso.title).toBeNull();
    }
    // Guarda de vacuidade: os motivos que abrem aviso de verdade foram medidos.
    expect(medidos).toBeGreaterThanOrEqual(3);
  });

  it("`other` + negócio sem o título do aviso de etapa não toca nada", () => {
    expect(somDoAviso({ kind: "other", ref_kind: "lead", title: "Outro aviso qualquer" })).toBeNull();
    expect(somDoAviso({ kind: "other", ref_kind: "lead" })).toBeNull();
  });

  it("IA sem saldo no provedor → som de pessoa (as respostas param até alguém recarregar)", () => {
    expect(somDoAviso({ kind: "other", ref_kind: "ai_provider_credential" })).toBe("pessoa");
  });

  it("abrir a página com avisos antigos não toca nada", () => {
    expect(sonsNovos(null, [{ id: "a", kind: "handoff", ref_kind: null }])).toEqual([]);
  });

  it("só o aviso que não estava lá toca — e um som por tipo", () => {
    const vistos = new Set(["a"]);
    expect(
      sonsNovos(vistos, [
        { id: "a", kind: "handoff", ref_kind: null },
        { id: "b", ...avisoDeEtapa("pt-BR") },
        { id: "c", ...avisoDeEtapa("es") },
      ]),
    ).toEqual(["venda"]);
  });
});

describe("o tipo do arquivo vem dos bytes", () => {
  it("MP3 (com e sem ID3), OGG e WAV são aceitos", () => {
    expect(farejarAudio(bytes("ID3"))).toBe("audio/mpeg");
    expect(farejarAudio(bytes([0xff, 0xfb]))).toBe("audio/mpeg");
    expect(farejarAudio(bytes("OggS"))).toBe("audio/ogg");
    expect(farejarAudio(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("audio/wav");
  });

  it("imagem ou texto com extensão .mp3 é recusado", () => {
    expect(farejarAudio(bytes([0x89], "PNG"))).toBeNull();
    expect(farejarAudio(bytes("hola"))).toBeNull();
  });
});
