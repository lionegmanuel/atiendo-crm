/**
 * A fronteira entre o BANCO e o motor de horários livres.
 *
 * `attendant_availability.schedule` é um **jsonb**, e jsonb não tem forma. O
 * motor (`horariosLivres`) é função pura e assume forma. Alguém tem que fazer a
 * travessia, e é aqui — uma vez só, para nenhuma rota reinventar.
 *
 * ─── Por que não é "só um cast" ───────────────────────────────────────────
 *
 * Medido com o que a coluna devolve de verdade, chamando o motor direto:
 *
 *   schedule `{}` (o DEFAULT da coluna) → TypeError em `windows.filter`
 *   `windows` ausente                   → TypeError
 *   `windows: null`                     → TypeError
 *   `timezone` ausente                  → **não** explode: usa o fuso do PROCESSO
 *
 * Os três primeiros são o caminho normal: todo atendente recém-criado tem o
 * `schedule` no default, então a agenda dele derrubaria a rota no primeiro
 * acesso.
 *
 * ⚠️ O QUARTO É O GRAVE, E É INVERTIDO — INVISÍVEL EM DEV, ERRADO EM PRODUÇÃO.
 *
 * Sem `timezone`, o `Intl` cai no fuso do processo. Medido neste repo:
 * `docker-compose.prod.yml:222` define `TZ: UTC` **apenas** no `scheduler`; o
 * serviço `app` não define TZ, e o `Dockerfile` é `node:22-alpine` sem
 * `tzdata`. Em produção o processo roda em **UTC**. Para uma clínica em São
 * Paulo isso faz a jornada 09:00–18:00 valer como 06:00–15:00 na parede dela —
 * horário oferecido às 6 da manhã, nenhum depois das 15h, e nenhum erro em
 * lugar nenhum. No Mac de quem desenvolve o `TZ` é `America/Sao_Paulo` e o
 * mesmo código acerta.
 *
 * ─── A peça que resolve já existia ────────────────────────────────────────
 *
 * `availabilityScheduleSchema` (`lib/schemas/routing.ts`) é o schema que a
 * DECISÃO 1 nomeia como fonte única: preenche os defaults, valida o fuso contra
 * o próprio `Intl` e recusa janela invertida. Aqui não há validação nova — há
 * reuso, e a garantia de que o motor nunca vê jsonb cru.
 */
import { availabilityScheduleSchema } from "@/lib/schemas/routing";

import type { JornadaDaAgenda } from "./horarios-livres";

/**
 * A recusa que o CLIENTE FINAL recebe quando a agenda está mal configurada.
 *
 * ⚠️ CONSTANTE EXPORTADA, e a razão é que ela terá TRÊS consumidores: as
 * ferramentas MCP (que falam pelo WhatsApp), a tela do agendamento e o aviso da
 * Central. Se cada um escrever a própria versão, o cliente ouve uma frase pelo
 * WhatsApp e lê OUTRA na tela para o mesmo estado — e esta é a hora barata de
 * evitar isso, com um consumidor só no mundo.
 *
 * ⚠️ E ELA DIZ O QUE FAZER EM SEGUIDA, não só o que não dá. É a doutrina de
 * `lib/mcp/recusa-para-o-modelo.ts`, medida com LLM real: uma recusa que só
 * informa a falha deixa o modelo com três saídas ruins à mão — dizer que
 * "estamos sem vagas" (FALSO: é configuração quebrada, não lotação), inventar
 * um horário para não frustrar, ou encerrar sem caminho nenhum. Nenhuma delas é
 * proibida por um texto que apenas constata.
 *
 * (Achado do MaestroConexoes relendo a implementação da própria proposta.)
 */
export const RECUSA_PARA_O_CLIENTE =
  "Os horários de atendimento ainda não estão disponíveis. Não ofereça horários " +
  "e não diga que está lotado — avise que alguém da equipe confirma o horário.";

export type LeituraDaJornada =
  | {
      ok: true;
      jornada: JornadaDaAgenda;
      /**
       * ⚠️ O FUSO FOI SUPOSTO, NÃO ESCOLHIDO — e depois do parse isso é
       * INDISTINGUÍVEL.
       *
       * `availabilityScheduleSchema` tem `.default("America/Sao_Paulo")`.
       * Medido: quem nunca configurou devolve `{timezone:"America/Sao_Paulo",
       * windows:[]}` e quem ESCOLHEU São Paulo devolve exatamente a mesma
       * coisa. O default preenche e não deixa rastro, então esta distinção só
       * existe se for capturada AQUI, no único ponto que ainda tem o jsonb cru
       * na mão.
       *
       * Não é preciosismo de tela: a IA OFERECE horário pelas ferramentas MCP.
       * Se ela disser "tenho terça às 14h" com um fuso suposto errado, o
       * paciente aparece uma hora fora — e ninguém liga uma coisa à outra.
       *
       * Mesmo formato de `publicouHorarios`: um booleano que preserva uma
       * distinção que o dado normalizado apaga.
       */
      fusoSuposto: boolean;
      /**
       * ⚠️ "NÃO PUBLIQUEI" E "NÃO TENHO VAGA" SÃO ESTADOS DIFERENTES.
       *
       * Sem janela publicada a agenda devolve zero horário — e a tela **não**
       * pode dizer "nenhum horário disponível" e calar, porque o dono concluiria
       * que está lotado. Ela diz "você ainda não publicou seus horários de
       * atendimento" e leva para lá (DECISÃO 1.1). Quem sabe distinguir é este
       * campo; sem ele os dois estados chegam à tela como a mesma lista vazia.
       */
      publicouHorarios: boolean;
    }
  | {
      ok: false;
      /**
       * Para o OPERADOR: a tela do dono da agenda e a Central. Nomeia o campo
       * (`fuso horário inválido (em \`timezone\`)`), porque quem vai corrigir
       * precisa saber onde.
       */
      motivoParaOperador: string;
      /**
       * ⚠️ PARA O CLIENTE FINAL — e existe como campo separado de propósito.
       *
       * As ferramentas MCP falam com quem está do outro lado do WhatsApp, e um
       * único campo `motivo` disponível faz o repasse virar o caminho de menor
       * esforço: o paciente receberia "fuso horário inválido em `timezone`".
       * Nome de coluna vazando para o cliente é falha de produto, e um
       * comentário pedindo cuidado não é vigiado por ninguém — com dois campos,
       * quem escreve MCP precisa ESCOLHER, e o compilador participa da escolha.
       *
       * (Decisão do MaestroConexoes, que foi ler este arquivo para alinhar o
       * contrato dele em vez de inventar uma terceira lista.)
       */
      motivoParaCliente: string;
    };

/**
 * Lê o `schedule` como ele vem do banco.
 *
 * `safeParse`, nunca `parse`: `windows: null` é representável no jsonb e um
 * `parse` viraria 500 numa rota de leitura.
 *
 * E a recusa **nunca** vira lista vazia silenciosa. Falha fechada na AÇÃO (não
 * oferece horário) e ABERTA na INFORMAÇÃO (diz o que está errado). Devolver `[]`
 * sem motivo faz o dono concluir "não tenho horário livre" quando o que ele tem
 * é schedule corrompido — e essa conclusão errada não gera chamado nenhum, então
 * ninguém descobre.
 */
export function lerJornadaDoBanco(scheduleDoBanco: unknown): LeituraDaJornada {
  // A LINHA QUE NÃO EXISTE (nenhuma disponibilidade cadastrada para este
  // responsável) é um estado diferente de "cadastrou errado": é "ainda não
  // cadastrou". Sem esta guarda ela caía no `safeParse` de baixo com
  // `scheduleDoBanco ?? undefined` — que é `undefined` de qualquer jeito — e
  // saía como "Invalid input: expected object, received undefined": frase que
  // não erra, mas não diz ao operador ONDE resolver, justamente o vício que o
  // resto desta função evita em toda outra recusa (ver `onde` abaixo). É o
  // estado documentado como "o que uma instalação fresca produz"
  // (`app/app/agenda/_client.tsx`) — comum, não exceção — e por isso merece
  // nome próprio em vez do fallback genérico do Zod.
  if (scheduleDoBanco === null || scheduleDoBanco === undefined) {
    return {
      ok: false,
      motivoParaOperador: "ainda não foi configurada. Configure em Equipe → Atendimento.",
      motivoParaCliente: RECUSA_PARA_O_CLIENTE,
    };
  }

  // ANTES do parse, e só aqui: depois dele o default já preencheu o fuso e a
  // suposição some sem rastro.
  const cru = scheduleDoBanco as { timezone?: unknown };
  const fusoSuposto = typeof cru.timezone !== "string" || cru.timezone.trim() === "";

  const lido = availabilityScheduleSchema.safeParse(scheduleDoBanco);

  if (!lido.success) {
    const primeiro = lido.error.issues[0];
    const onde = primeiro?.path?.length ? ` (em \`${primeiro.path.join(".")}\`)` : "";
    return {
      ok: false,
      motivoParaOperador: `está mal configurada: ${primeiro?.message ?? "formato inesperado"}${onde}`,
      motivoParaCliente: RECUSA_PARA_O_CLIENTE,
    };
  }

  return {
    ok: true,
    jornada: { timezone: lido.data.timezone, windows: lido.data.windows },
    publicouHorarios: lido.data.windows.length > 0,
    fusoSuposto,
  };
}
