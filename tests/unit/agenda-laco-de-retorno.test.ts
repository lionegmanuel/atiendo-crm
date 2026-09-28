/**
 * O LAÇO DE RETORNO DO AGENDAMENTO — invariante 7 do Sistema Vivo.
 *
 * Marcar um horário não é escrever uma linha: é um fato que precisa VOLTAR ao
 * sistema. A doutrina cobra dois emissores, e eles respondem perguntas
 * diferentes:
 *
 *   `crm_lead_activities`  → o HUMANO vê na timeline do lead que houve consulta
 *   `event_log`            → o WORKER leva o compromisso para o Google
 *
 * Um sem o outro deixa metade do laço aberto: só a atividade e o Google nunca
 * sabe; só o evento e a equipe não vê o que a IA marcou.
 *
 * Este arquivo testa a parte que DECIDE — qual atividade cada transição emite —
 * separada da que grava, porque a decisão é onde mora o erro silencioso: emitir
 * o tipo errado deixa a timeline com a frase errada e ninguém percebe, já que a
 * linha existe.
 */
import { describe, expect, it } from "vitest";

import {
  atividadeDaTransicao,
  autorParaTimeline,
  precisaEmpurrarAoGoogle,
} from "@/lib/agenda/laco";

describe("qual atividade cada transição emite", () => {
  it("nascer confirmado é 'marcado'", () => {
    expect(atividadeDaTransicao(null, "confirmed")).toBe("appointment_scheduled");
  });

  it("nascer pendente TAMBÉM é 'marcado' — quem lê a timeline quer saber que foi marcado", () => {
    // A distinção pendente/confirmado é de OPERAÇÃO, não de linha do tempo. Um
    // tipo separado só para "pediram e ainda não confirmaram" encheria a
    // timeline de ruído sem mudar o que o humano precisa fazer.
    expect(atividadeDaTransicao(null, "pending")).toBe("appointment_scheduled");
  });

  it("mudar de horário é 'remarcado', não um novo 'marcado'", () => {
    // Emitir `scheduled` de novo faria a timeline mostrar duas marcações e
    // nenhuma remarcação — o histórico contaria uma história que não aconteceu.
    expect(atividadeDaTransicao("confirmed", "rescheduled")).toBe("appointment_rescheduled");
  });

  it("cancelar, comparecer e faltar têm cada um o seu", () => {
    expect(atividadeDaTransicao("confirmed", "cancelled")).toBe("appointment_cancelled");
    expect(atividadeDaTransicao("confirmed", "completed")).toBe("appointment_completed");
    expect(atividadeDaTransicao("confirmed", "no_show")).toBe("appointment_no_show");
  });

  it("transição que não muda nada NÃO emite atividade", () => {
    // Emitir por PATCH que só mexeu em observação encheria a timeline de linhas
    // sem fato — e timeline com ruído é timeline que ninguém lê.
    expect(atividadeDaTransicao("confirmed", "confirmed")).toBeNull();
    expect(atividadeDaTransicao("pending", "pending")).toBeNull();
  });

  it("confirmar um pendente não é remarcar nem marcar de novo", () => {
    // É operação interna: o compromisso já estava na timeline desde o pedido.
    expect(atividadeDaTransicao("pending", "confirmed")).toBeNull();
  });
});

describe("quando o Google precisa saber", () => {
  it("nascer, remarcar e cancelar empurram", () => {
    expect(precisaEmpurrarAoGoogle(null, "confirmed")).toBe(true);
    expect(precisaEmpurrarAoGoogle("confirmed", "rescheduled")).toBe(true);
    expect(precisaEmpurrarAoGoogle("confirmed", "cancelled")).toBe(true);
  });

  it("compareceu e faltou NÃO empurram — são fato nosso, não do calendário", () => {
    // O evento no Google já aconteceu; marcar "compareceu" aqui não muda nada
    // lá. Empurrar geraria escrita externa sem efeito, e escrita externa é a
    // coisa mais cara e mais arriscada que esta feature faz.
    expect(precisaEmpurrarAoGoogle("confirmed", "completed")).toBe(false);
    expect(precisaEmpurrarAoGoogle("confirmed", "no_show")).toBe(false);
  });

  it("o que não muda nada não empurra", () => {
    expect(precisaEmpurrarAoGoogle("confirmed", "confirmed")).toBe(false);
  });
});

/**
 * O AUTOR ATRAVESSA DUAS LISTAS QUE DIVERGEM NA PONTA.
 *
 *   `AUTORES_DO_AGENDAMENTO`              user · ai · system · contact · sync
 *   `crm_lead_activities.actor_kind` CHECK user · ai · system · rule · contact
 *
 * `sync` só existe de um lado, `rule` só do outro. Gravar `sync` na timeline é
 * 23514 em RUNTIME, dentro de caminho fire-and-forget — invisível para
 * typecheck, lint, test:unit e CI. O sintoma seria a atividade não nascendo, em
 * silêncio.
 */
describe("o autor traduzido para a timeline", () => {
  it("os três que existem nos dois lados passam intactos", () => {
    expect(autorParaTimeline("user")).toBe("user");
    expect(autorParaTimeline("ai")).toBe("ai");
    expect(autorParaTimeline("contact")).toBe("contact");
  });

  it("SYNC vira system — e é por significado, não por conveniência", () => {
    // Quem sincronizou não é pessoa nem IA: é o produto trazendo um fato de
    // fora. A origem específica não se perde, continua em
    // `calendar_appointments.created_by_kind`.
    expect(autorParaTimeline("sync")).toBe("system");
  });

  it("valor desconhecido também vira system, nunca explode em runtime", () => {
    // O desfecho seguro é a atividade NASCER como do sistema. Deixar passar
    // seria trocar uma linha genérica por linha nenhuma.
    expect(autorParaTimeline("um_autor_que_nao_existe")).toBe("system");
  });

  it("NENHUMA saída está fora do CHECK do banco", () => {
    const doCheck = ["user", "ai", "system", "rule", "contact"];
    for (const entrada of ["user", "ai", "system", "contact", "sync", "inventado"]) {
      expect(doCheck).toContain(autorParaTimeline(entrada));
    }
  });
});
