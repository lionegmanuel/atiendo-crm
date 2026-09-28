/**
 * COM O PAPEL DESLIGADO, O TURNO NÃO ENFILEIRA NADA.
 *
 * ## O que se pagava
 *
 * A decisão de RODAR o Operador era função pura desde o primeiro dia
 * (`decidirSeRoda`). A de ENFILEIRAR não existia como decisão — ficou implícita em
 * "sempre". A decisão (e) da spec declarou o custo em dinheiro (+1 chamada de
 * modelo com o papel ligado) e ninguém declarou o custo em CAPACIDADE DE FILA, que
 * era pago mesmo com o papel desligado — o default de toda instalação.
 *
 * Por turno, para escrever uma linha de log num contêiner que o dono do negócio
 * nunca abre: um job, um dos slots de concorrência e a única vaga daquele lead no
 * lote do claim (`distinct on (coalesce(contact_id, id))`). Sob rajada, é o turno
 * de CRM sendo servido antes da próxima mensagem do cliente.
 *
 * ## O que este arquivo guarda, e o que ele NÃO guarda
 *
 * Guarda a REGRA. O COMPORTAMENTO — o job de fato não nascer — é guardado pelo
 * invariante, contra Postgres real. A distinção é a razão de os dois existirem:
 * apagar esta função e inlinar o `if` no chamador não reprova nada aqui, e essa
 * assimetria é informação — o unit protege a forma, o invariante protege o efeito.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decidirSeEnfileiraOperador } from "@/lib/agent-engine/agent/inbound-turn";

describe("decidirSeEnfileiraOperador", () => {
  it("sem agente publicado não enfileira — não há config de papel para ler", () => {
    expect(
      decidirSeEnfileiraOperador({ temAgentePublicado: false, papelLigado: false }),
    ).toEqual({ enfileira: false, porque: "sem_agente" });
  });

  it("ORDEM: sem agente vence papel ligado — a config lida seria de outro agente", () => {
    // Cobrir os dois caminhos separados não prova a precedência. `papelLigado`
    // true sem agente publicado é um estado que só existe por engano de chamada, e
    // a razão registrada tem de ser a mais específica.
    expect(
      decidirSeEnfileiraOperador({ temAgentePublicado: false, papelLigado: true }),
    ).toEqual({ enfileira: false, porque: "sem_agente" });
  });

  it("agente publicado com o papel desligado não enfileira, e diz por quê", () => {
    expect(
      decidirSeEnfileiraOperador({ temAgentePublicado: true, papelLigado: false }),
    ).toEqual({ enfileira: false, porque: "papel_desligado" });
  });

  it("papel ligado enfileira — guarda de vacuidade da suíte", () => {
    // Sem este caso, uma função que NUNCA enfileira passaria em todos os outros e
    // desligaria o papel para quem o ligou.
    expect(
      decidirSeEnfileiraOperador({ temAgentePublicado: true, papelLigado: true }),
    ).toEqual({ enfileira: true, porque: "ligado" });
  });
});

/**
 * O CALL SITE — e por que este caso existe apesar de medir TEXTO.
 *
 * A função acima pode estar perfeita e o chamador ignorá-la: é o mesmo formato de
 * lacuna que uma sabotagem já encontrou nesta série (a leitura da escolha por
 * organização estava certa, o motor deixou de chamá-la, e treze testes seguiram
 * verdes). O ideal seria exercitar o turno inteiro contra Postgres e afirmar que o
 * job NÃO nasce — é o que o plano chama de indispensável, e fica declarado como
 * dívida: exige montar modelo falso, adaptador de canal e relógio fixo.
 *
 * Até lá, esta guarda estática cobre a regressão real (alguém apagar o `if`) por um
 * custo próximo de zero. A fraqueza é conhecida: mede a FORMA do código, então um
 * refactor que preserve o comportamento e mude o texto reprova aqui — falso
 * positivo barato de corrigir, e preferível ao silêncio.
 */
describe("o chamador honra a decisão", () => {
  const fonte = readFileSync(
    path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("o enfileiramento do Operador está DENTRO da decisão", () => {
    const i = fonte.indexOf("kind: 'operator_turn',");
    // Controle positivo: se o enqueue mudou de forma, este caso para de medir o
    // que diz medir — e avisa, em vez de passar vazio.
    expect(i, "não achei o enfileiramento do Operador — ENSINE ESTE TESTE").toBeGreaterThan(0);

    const antes = fonte.slice(Math.max(0, i - 700), i);
    expect(
      antes.includes("decidirSeEnfileiraOperador("),
      "o turno voltou a enfileirar sem consultar a decisão: com o papel desligado " +
        "(o default de toda instalação) volta a gastar um job, um slot de concorrência " +
        "e a vaga do lead no claim para escrever uma linha de log.",
    ).toBe(true);
    expect(antes.includes("disparo.enfileira")).toBe(true);
  });
});
