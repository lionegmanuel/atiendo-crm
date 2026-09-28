/**
 * TODO EVENTO-COMANDO TEM CONSUMIDOR (issue #129).
 *
 * ## O defeito que fez este arquivo existir
 *
 * `workers/ai-response-worker.ts` insere a mensagem outbound com
 * `status='sending'` e emite `message.send_requested`. **Nada consome esse
 * evento.** Nenhum handler de `lib/event-log/register-handlers.ts` o declara, e
 * o drain filtra por `event_type in (tipos declarados)` — então essas linhas
 * ficam `pending` para sempre, e a mensagem fica "enviando" para sempre na tela
 * de quem instalou.
 *
 * "Evento sem consumer" é anti-pattern nomeado no `CLAUDE.md` (nº 3) e não
 * tinha gate nenhum. Uma regra escrita que nenhuma catraca cobra é uma regra
 * que já foi violada e ninguém soube.
 *
 * ## Por que só os `*_requested`
 *
 * O `event_log` carrega duas famílias, e tratá-las igual daria falso positivo
 * em massa:
 *
 *   - **fato** (`ai.responded`, `lead.created`, `message.sent`): descrevem o que
 *     ACONTECEU. Existem para realtime da UI, auditoria e consulta. Ninguém
 *     precisa consumi-los, e exigir consumidor os transformaria em ruído.
 *   - **comando** (`*_requested`): descrevem o que alguém PEDIU que acontecesse.
 *     Sem consumidor, o pedido nunca é atendido — e o pior é que a linha fica
 *     `pending`, com cara de trabalho na fila.
 *
 * A convenção `_requested` já é a do repo (`media.persist_requested`,
 * `media.derive_requested`, `ai_agent.dispatch_requested`), então a regra é
 * mecânica e não depende de julgamento caso a caso.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getRegisteredHandlers } from "@/lib/event-log/dispatcher";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";

const RAIZES = ["app", "lib", "workers"];
const EMISSAO = /p_event_type:\s*"([a-z0-9_.]+)"/g;

/**
 * Consumidores que NÃO são handlers do `event_log` — o registry não os conhece,
 * mas eles existem e o arquivo está nomeado para poder ser conferido.
 */
const CONSUMIDORES_FORA_DO_REGISTRY: Record<string, string> = {
  "ai_agent.dispatch_requested":
    "lib/agent-engine/edge/crm/drain.ts — o agent-engine roda em processo próprio " +
    "(serviço `worker` do docker-compose.prod.yml) e drena direto do event_log. " +
    "Quem é o dono é config: AGENT_DISPATCH_CONSUMER ('engine' default | 'native'), " +
    "e o invariante tests/invariants/agent-dispatch-single-consumer.test.ts prova " +
    "que nunca são os dois.",
};

/**
 * Comando emitido que segue SEM consumidor, com a razão e o que falta decidir.
 * Isto é dívida DECLARADA, não anistia: o teste abaixo cobra que a lista não
 * envelheça, então no dia em que alguém plugar o consumidor a entrada reprova.
 */
const SEM_CONSUMIDOR_CONHECIDO: Record<string, string> = {
  "message.send_requested":
    "Emitido por workers/ai-response-worker.ts para um worker de despacho que " +
    "nunca foi construído (S-06.x do EPIC-03). Hoje quem de fato responde o " +
    "cliente numa instalação padrão é o agent-engine, por outro caminho " +
    "(ai_agent.dispatch_requested → POST /api/v1/messages). Plugar um consumidor " +
    "aqui SEM antes resolver a sobreposição entre os dois runtimes trocaria o " +
    "problema atual por um pior: resposta em dobro ao cliente. A decisão de " +
    "arquitetura está aberta na issue #129; enquanto ela não sai, a mensagem " +
    "presa deixou de ser invisível — o cron recover-stuck-messages a marca como " +
    "falha e abre aviso na Central.",
};

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : arquivos(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function tiposEmitidos(): string[] {
  const achados = new Set<string>();
  for (const f of RAIZES.flatMap(arquivos)) {
    for (const m of readFileSync(f, "utf8").matchAll(EMISSAO)) achados.add(m[1]!);
  }
  return [...achados].sort();
}

function tiposConsumidos(): Set<string> {
  ensureHandlersRegistered();
  return new Set(getRegisteredHandlers().flatMap((h) => h.events));
}

describe("evento-comando (*_requested) tem consumidor", () => {
  it("a varredura acha emissões (guarda de vacuidade)", () => {
    // Sem isto, mudar o jeito de emitir (helper novo, outro nome de parâmetro)
    // faria a asserção principal passar por AUSÊNCIA de dado — o instrumento
    // cego devolvendo verde, que é exatamente como o defeito original viveu.
    expect(tiposEmitidos().length).toBeGreaterThanOrEqual(20);
  });

  it("o registry de handlers não vem vazio (guarda de vacuidade)", () => {
    expect(tiposConsumidos().size).toBeGreaterThanOrEqual(5);
  });

  it("todo comando emitido é consumido por alguém", () => {
    const consumidos = tiposConsumidos();
    const orfaos = tiposEmitidos()
      .filter((t) => t.endsWith("_requested"))
      .filter((t) => !consumidos.has(t))
      .filter((t) => !(t in CONSUMIDORES_FORA_DO_REGISTRY))
      .filter((t) => !(t in SEM_CONSUMIDOR_CONHECIDO));
    expect(
      orfaos,
      "evento-comando sem consumidor — anti-pattern nº 3 do CLAUDE.md. A linha " +
        "fica `pending` para sempre com cara de trabalho na fila, e quem pediu " +
        "nunca é atendido. Registre um handler em lib/event-log/register-handlers.ts, " +
        "ou pare de emitir.",
    ).toEqual([]);
  });

  it("as duas listas de exceção não envelhecem", () => {
    // Exceção resolvida e esquecida aqui mente para a próxima pessoa: ela lê
    // "isto é conhecido e aceito" sobre algo que já tem dono.
    const emitidos = new Set(tiposEmitidos());
    const consumidos = tiposConsumidos();

    for (const tipo of Object.keys(SEM_CONSUMIDOR_CONHECIDO)) {
      expect(emitidos.has(tipo), `${tipo} já não é emitido — remova de SEM_CONSUMIDOR_CONHECIDO`).toBe(
        true,
      );
      expect(
        consumidos.has(tipo),
        `${tipo} ganhou consumidor — remova de SEM_CONSUMIDOR_CONHECIDO`,
      ).toBe(false);
    }

    for (const tipo of Object.keys(CONSUMIDORES_FORA_DO_REGISTRY)) {
      expect(
        emitidos.has(tipo),
        `${tipo} já não é emitido — remova de CONSUMIDORES_FORA_DO_REGISTRY`,
      ).toBe(true);
    }
  });
});
