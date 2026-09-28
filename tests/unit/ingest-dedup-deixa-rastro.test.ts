/**
 * Dedup na porta de entrada não pode ser invisível.
 *
 * Achado medindo turnos reais (W4): 5 mensagens do cliente produziram 4 jobs e
 * NENHUM registro de dedup. A pergunta "cadê o turno da quinta?" não tinha
 * resposta no log — e essa era a resposta.
 *
 * O `return` no `23505` está certo: reingerir duplicaria a mensagem do cliente.
 * O defeito era sair MUDO, porque aí "dedup legítimo" e "mensagem perdida por
 * outro caminho" produzem exatamente o mesmo silêncio, no lugar mais caro do
 * sistema — a porta de entrada.
 *
 * Este teste guarda as duas metades: o dedup deixa rastro, E o caminho normal
 * (mensagem nova) não polui o log. Alarme que toca sempre é alarme desligado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { logger } from "@/lib/logger";

/** Reproduz a decisão exata do ingest, sem subir Supabase. */
function trataInsert(
  insertErr: { code: string; message: string } | null,
  ctx: { organization_id: string; conversation_id: string; external_id: string },
): "erro" | "dedup" | "seguiu" {
  if (insertErr && insertErr.code !== "23505") {
    console.error("[waha.ingest] message insert failed", insertErr.message);
    return "erro";
  }
  if (insertErr?.code === "23505") {
    logger.info("waha.ingest: inbound ja ingerido, dedup por external_id", {
      organization_id: ctx.organization_id,
      conversation_id: ctx.conversation_id,
      external_id: ctx.external_id,
      direcao: "inbound",
    });
    return "dedup";
  }
  return "seguiu";
}

const CTX = { organization_id: "org-1", conversation_id: "conv-1", external_id: "wamid.X" };

describe("dedup do ingest deixa rastro", () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    info = vi.spyOn(logger, "info").mockImplementation(() => {});
  });
  afterEach(() => info.mockRestore());

  it("mensagem repetida vira dedup COM registro, e o registro identifica qual", () => {
    const r = trataInsert({ code: "23505", message: "duplicate key" }, CTX);

    expect(r).toBe("dedup");
    expect(info).toHaveBeenCalledOnce();
    // O `external_id` é o que permite responder "cadê o turno dessa mensagem?".
    // Sem ele o registro diria que houve dedup e não qual — meia resposta.
    const [, campos] = info.mock.calls[0] as [string, Record<string, unknown>];
    expect(campos.external_id).toBe("wamid.X");
    expect(campos.conversation_id).toBe("conv-1");
  });

  it("mensagem nova NÃO gera registro de dedup (log que sempre fala é ignorado)", () => {
    expect(trataInsert(null, CTX)).toBe("seguiu");
    expect(info).not.toHaveBeenCalled();
  });

  it("erro real continua sendo erro, não vira dedup", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(trataInsert({ code: "42P01", message: "relation does not exist" }, CTX)).toBe("erro");
    expect(info, "falha de infra não pode se disfarçar de dedup").not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  /**
   * ⚠️ Os casos acima reproduzem a DECISÃO para não subir Supabase — e isso é
   * uma fraqueza real: se alguém tirar o log do `ingest`, eles continuam verdes
   * guardando a cópia. Este caso ancora no fonte de verdade.
   *
   * Mesmo padrão do controle positivo do mint: sem ler o arquivo real, o resto
   * do teste descreveria um mundo que deixou de existir.
   */
  it("o INGEST de verdade não sai mudo no dedup (âncora no fonte)", () => {
    const fonte = readFileSync(
      join(process.cwd(), "lib/waha/ingest.ts"),
      "utf8",
    );
    const trechos = fonte.split('if (insertErr?.code === "23505")');
    // Sai um trecho antes + um por caminho de dedup (inbound e outbound).
    expect(trechos.length, "esperado 2 caminhos de dedup no ingest").toBe(3);
    for (const t of trechos.slice(1)) {
      // Janela larga o bastante para o comentário que explica o porquê: medido,
      // o do inbound sozinho passa de 500 chars e cortava o `logger.info` fora.
      const bloco = t.slice(0, 1200);
      expect(bloco, "caminho de dedup sem registro volta a ser invisível").toMatch(
        /logger\.info\(/,
      );
      expect(bloco, "registro sem external_id não responde QUAL mensagem").toMatch(
        /external_id/,
      );
    }
  });

  it("dedup inbound reacelera o pipeline de follow-up (âncora no fonte)", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/waha/ingest.ts"), "utf8");
    const inbound = fonte.split('if (insertErr?.code === "23505")')[1] ?? "";
    expect(inbound.slice(0, 2000), "reentrega WAHA tem que destravar match_reply").toMatch(
      /acelerarPipelineDeEventos/,
    );
  });
});
