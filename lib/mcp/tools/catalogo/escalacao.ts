/**
 * Capacidades de ESCALAÇÃO — o ciclo completo entre o agente e uma pessoa.
 *
 * O pacote nasceu com UMA capacidade: chamar um atendente. Depois disso o agente
 * ficava cego — não listava chamados, não lia o que a pessoa decidiu, não sabia
 * se o caso foi resolvido, não conseguia retomar. E também não enxergava quem
 * estava disponível, então escalava para uma fila que podia não ter ninguém.
 * Na prática ele jogava o problema por cima do muro e sumia.
 *
 * As seis capacidades abaixo fecham as duas direções: o agente participa do
 * atendimento humano em vez de terminar nele.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * HANDLER (`lib/mcp/tools/<dominio>.ts`), e ela NÃO tem cópia aqui: até
 * 2026-08-07 tinha, ninguém lia essa cópia, e 48 das 51 divergiam do que o
 * modelo realmente recebia. O campo foi removido em vez de sincronizado —
 * duplicata que ninguém lê não é documentação, é armadilha: um script de
 * medição de vazamento chegou a montar o prompt com o texto errado, sob um
 * comentário dizendo "a ferramenta como o modelo a vê".
 * Ver `docs/handoffs/BRIEFING-ia-360.md` §4.
 */
import { declararTools } from "./tipos";

export const TOOLS_ESCALACAO = declararTools([
  {
    name: "crm_list_available_attendants",
    category: "read",
    rotulo: "Ver quem pode assumir agora",
    explicacao:
      "Mostra quais pessoas da equipe estão em atendimento neste momento, quantas conversas cada uma já tem e quem ainda tem espaço para receber mais uma.",
    oQueToca: "Equipe de atendimento",
    risco: "seguro",
    pacotes: ["escalar", "atender"],
  },
  {
    name: "crm_list_human_cases",
    category: "read",
    rotulo: "Ver os chamados em aberto",
    explicacao:
      "Lista os assuntos que já foram passados para uma pessoa resolver, com o estado de cada um, para o agente não pedir duas vezes a mesma coisa.",
    oQueToca: "Chamados para uma pessoa",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_get_human_case",
    category: "read",
    rotulo: "Ler um chamado e o que a pessoa decidiu",
    explicacao:
      "Abre um chamado e mostra tudo que aconteceu nele, inclusive a decisão que a pessoa tomou e o texto que ela escreveu ao decidir.",
    oQueToca: "Chamados para uma pessoa",
    risco: "seguro",
    pacotes: ["escalar"],
  },
  {
    name: "crm_add_case_note",
    category: "write",
    rotulo: "Registrar o que aconteceu num chamado",
    explicacao:
      "Deixa escrito no chamado o que mudou desde que ele foi aberto, para a pessoa que for atender não precisar começar do zero.",
    oQueToca: "Chamados para uma pessoa",
    risco: "atencao",
    pacotes: ["escalar"],
  },
  {
    name: "crm_close_human_case",
    category: "write",
    rotulo: "Encerrar um chamado com o desfecho",
    explicacao:
      "Fecha um chamado deixando registrado como ele terminou, para ele parar de ocupar a fila de quem atende. Não dá para reabrir por aqui.",
    oQueToca: "Chamados para uma pessoa",
    risco: "critico",
    pacotes: ["escalar"],
  },
  {
    name: "crm_resume_ai_attendance",
    category: "write",
    rotulo: "Retomar o atendimento automático",
    explicacao:
      "Devolve a conversa para o atendimento automático depois que uma pessoa atendeu, levando junto o que ficou combinado com o cliente. Só uma pessoa pode acionar.",
    oQueToca: "Atendimento",
    risco: "critico",
    pacotes: ["escalar"],
  },
]);
