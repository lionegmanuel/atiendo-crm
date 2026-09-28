"use client";

/**
 * O EMISSOR — a tela aberta dizendo que está aberta.
 *
 * ─── O que faltava ─────────────────────────────────────────────────────────
 *
 * O produto tinha o leitor do sinal de presença e nunca teve o emissor: o cron
 * `attendant-heartbeat` desligava o plantão de quem não emitisse sinal de vida
 * em 15 min, e nenhum arquivo do repositório emitia sinal nenhum. Este hook é o
 * emissor que faltava (issue #996, decisão 18) — e, desde o #720, ele não
 * desliga o plantão de ninguém: o único efeito de parar de bater é a pessoa
 * deixar de aparecer como presente.
 *
 * ─── Custo ─────────────────────────────────────────────────────────────────
 *
 * Uma escrita por aba a cada `INTERVALO_DO_SINAL_SEGUNDOS` (60 s), na coluna
 * `last_heartbeat_at` e em mais nenhuma — o espaçamento é decidido por
 * `deveEmitirSinal`, que é a função que responde "quantas escritas isso gera"
 * (medida em `tests/unit/presenca-do-atendente.test.ts`).
 *
 * Não há sinal de despedida (`beforeunload`, `sendBeacon`) de propósito: fechar
 * a aba NÃO escreve nada. Quem responde "sumiu" é o prazo do sinal, derivado na
 * leitura — se houvesse escrita na saída, o número de escritas voltaria a
 * depender de quantas abas a pessoa fecha, e um navegador que não entrega o
 * evento (crash, aba morta, celular bloqueado) ficaria preso em "presente" para
 * sempre, exatamente como o carimbo de clique do defeito original.
 */

import { useEffect } from "react";

import { deveEmitirSinal, INTERVALO_DO_SINAL_SEGUNDOS } from "@/lib/atendimento/presenca";

/** A rota do emissor. Uma só, e ela escreve uma coluna. */
export const URL_DO_SINAL_DE_PRESENCA = "/api/v1/attendants/presence";

/**
 * Bate o sinal de presença enquanto a tela existir.
 *
 * `ativo` é falso para quem não é atendente (viewer): a rota exige agent+, e
 * uma batida que só colhe 403 é ruído de rede em nome de ninguém.
 */
export function useSinalDePresenca(ativo: boolean): void {
  useEffect(() => {
    if (!ativo) return;

    let ultimoEnvioEm: Date | null = null;
    let parado = false;

    const bater = () => {
      const agora = new Date();
      if (parado || !deveEmitirSinal({ ultimoEnvioEm, now: agora })) return;
      // Marca ANTES de enviar: o espaçamento é o teto de custo, e uma resposta
      // lenta não pode virar duas escritas no mesmo minuto.
      ultimoEnvioEm = agora;
      void fetch(URL_DO_SINAL_DE_PRESENCA, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {
        // Silencioso de propósito: perder uma batida não é erro para quem usa a
        // tela — o prazo do sinal tolera duas perdidas seguidas e o próximo
        // tique recoloca a pessoa como presente. Falha aqui não vira toast nem
        // console: é sinal de vida, não operação da pessoa.
      });
    };

    // Primeira batida no MOUNT, não no primeiro tique: abrir a tela marca
    // presença em menos de um segundo, e não no fim do intervalo.
    bater();
    const tique = window.setInterval(bater, INTERVALO_DO_SINAL_SEGUNDOS * 1000);

    // Voltar para a aba bate na hora. Navegador em segundo plano alinha timers a
    // 1/min (Chrome, depois de ~5 min) e alguns os suspendem: sem isto, quem
    // volta para a tela esperaria até um intervalo inteiro para reaparecer como
    // presente — e quem olhasse a lista nesse meio-tempo veria "sem sinal" numa
    // pessoa que está na frente do computador.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") bater();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      parado = true;
      window.clearInterval(tique);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ativo]);
}
