/**
 * A recusa de uma capacidade, escrita para o MODELO — e, por tabela, para quem
 * vai ler a resposta dele.
 *
 * ⚠️ POR QUE ISTO EXISTE, medido com LLM real (`gpt-5.6-terra`). Pedi ao agente
 * uma etapa nova de funil. Ele tentou, a barreira de papel segurou (nada foi
 * escrito — confirmado no banco), e a frase que chegou ao usuário foi:
 *
 *   "Não consegui criar a etapa: SEU perfil atual é agent, e essa alteração
 *    exige permissão de manager."
 *
 * A barreira funcionou; **a frase mente**. O papel `agent` é do ASSISTENTE, não
 * de quem lê. Um dono com papel `admin` conclui que o sistema se confundiu; e
 * num atendimento de verdade quem lê é o CLIENTE da empresa, que não tem papel
 * nenhum no CRM — a frase vaza `agent`/`manager`, vocabulário interno, para fora.
 *
 * O modelo não errou: ele recebeu `Role 'agent' insufficient (required:
 * 'manager')` e fez o melhor possível com uma mensagem que fala de "role" sem
 * dizer DE QUEM. O conserto é dar a ele um texto que já sabe o que é — a mesma
 * ideia do veto instrutivo dos gates de envio: a recusa não é só "não", é o que
 * fazer em seguida.
 *
 * ⚠️ NÃO É COSMÉTICO E NÃO AFROUXA NADA. `ensureRole` continua sendo quem barra;
 * aqui só se traduz o que já foi decidido. A mensagem técnica original vai para
 * o log e para a observabilidade, onde ela serve.
 */
import { catalogEntry } from "@/lib/mcp/tools/catalog";

/**
 * O que o modelo recebe quando uma capacidade é recusada por papel.
 *
 * ⚠️ DUAS SITUAÇÕES DIFERENTES, e a distinção importa para quem lê a resposta:
 *
 * - `apenasHumano` — restrição DELIBERADA. A capacidade é operada por gente com
 *   acesso de gestor, e a tela declara isso. O caminho existe: pedir a alguém do
 *   time. A instrução manda o agente oferecer isso.
 * - sem a marca — restrição por ACIDENTE (o BUG-02 desta wave). O humano ligou
 *   uma capacidade que o agente não alcança, e ninguém foi avisado. Aqui o
 *   agente não deve prometer que "um gestor faz": ele deve dizer que não
 *   consegue e sugerir que a pessoa fale com quem cuida do sistema, porque isso
 *   é defeito de configuração, não desenho.
 */
export function recusaDeCapacidadeParaOModelo(toolName: string): string {
  const entrada = catalogEntry(toolName);
  const oQue = entrada?.rotulo ? `«${entrada.rotulo.toLowerCase()}»` : "essa alteração";

  if (entrada?.apenasHumano) {
    return [
      `Esta ação (${oQue}) é operada por uma PESSOA do time com acesso de gestor — você não a executa.`,
      "Não é falha sua nem falta de permissão de quem está falando com você:",
      "é assim que o sistema foi configurado, e a tela de capacidades declara isso.",
      "Explique em uma frase, sem citar cargos internos do sistema nem termos como",
      '"agent", "manager", "papel" ou "permissão", e ofereça que alguém do time faça.',
      "Se você já apurou algo útil (por exemplo, que o item ainda não existe), diga junto.",
    ].join(" ");
  }

  return [
    `Você não consegue executar esta ação (${oQue}) neste momento.`,
    "Isso é uma limitação da configuração do sistema, não um problema de quem está falando com você.",
    "Diga que não conseguiu, sem citar cargos internos nem termos como",
    '"agent", "manager", "papel" ou "permissão", e oriente a pessoa a falar com quem cuida do sistema.',
  ].join(" ");
}
