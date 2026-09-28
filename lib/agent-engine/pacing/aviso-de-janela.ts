/**
 * O silêncio da janela anti-ban deixa de ser invisível.
 *
 * ## O defeito, medido em produção (VPS, domingo 2026-08-30)
 *
 * O dono escreveu "meus agentes de IA não estão respondendo mais, e não aparece
 * NENHUMA execução, nem de erro nem de nada". Estava certo nas duas metades.
 *
 * `channel_knobs.allow_sunday = false` (gravado em 2026-08-06 pela tela
 * Anti-ban, em Conexões) fazia `inbound-turn.ts` adiar TODO turno de domingo
 * para segunda às 7h. O adiamento é a decisão certa — melhor a mensagem sair
 * amanhã cedo do que o número ser banido — mas ele acontecia assim:
 *
 *     runLog.info('turno adiado — fora da janela anti-ban de envio', {...})
 *     throw new JobSettledError(...)
 *
 * ...e nada mais. Sem linha em `agent_inbox_items`, sem atividade no lead, sem
 * marca na Inbox. O único registro morria no log do contêiner, onde o dono de
 * uma VPS não vai olhar. Do lado de fora, o sistema ficava mudo por um dia
 * inteiro **afirmando estar saudável** — todos os contêineres `healthy`.
 *
 * Um turno adiado não é erro, e por isso não aparecia em `llm_calls` (não houve
 * chamada de modelo). Era o pior tipo de silêncio: o que não deixa rastro em
 * lugar nenhum.
 *
 * ## Por que o aviso é por CANAL, e não por conversa
 *
 * A janela fecha para o número inteiro. Se 50 pessoas escrevem no domingo, o
 * fato a comunicar continua sendo UM ("este número está calado até segunda"),
 * não 50. `ref_id = channel_session_id` + dedup por `status='open'` é o que
 * transforma uma rajada num único aviso — mesmo padrão de `escalateJailbreakPromise`.
 *
 * Cinquenta avisos idênticos seriam ruído, e ruído na Central é como um alarme
 * que toca sempre: ensina a ignorar.
 *
 * ## Por que ele se resolve sozinho
 *
 * Um aviso que só o humano fecha viraria dívida: na segunda-feira o número volta
 * a atender e o painel continuaria dizendo que está calado. `resolverAvisoDeJanela`
 * é chamado no MESMO ponto do turno em que a janela é encontrada ABERTA — o laço
 * fecha onde ele foi aberto, sem varredura nem cron.
 *
 * `kind='other'` de propósito: um kind próprio exigiria migration + apêndice no
 * baseline, e o CHECK de `agent_inbox_items.kind` quebraria o `update.sh` de todo
 * clone que ainda não a aplicou. Quem distingue este aviso dos outros é o
 * `ref_kind`, que é texto livre.
 */
import type { Queryable } from '../queue/queue';

/** O `ref_kind` que identifica este aviso — a chave de dedup e de resolução. */
export const REF_KIND_JANELA = 'janela_de_envio_fechada';

export interface AvisoDeJanelaInput {
  tenantId: string;
  channelSessionId: string;
  /** Quando a janela reabre — o que o operador precisa saber para decidir se age. */
  abertura: Date;
  /** `7h-22h`, para o corpo dizer QUAL janela está em vigor. */
  janela: string;
  /** O fuso em que a janela é lida; sem ele "22h" é ambíguo. */
  timezone: string;
  /**
   * O domingo está desligado para este canal? Muda a AÇÃO de quem lê: se sim, há
   * um botão a virar em Conexões › Anti-ban; se não, é só a noite passando e não
   * há nada a fazer.
   */
  domingoDesligado: boolean;
}

/**
 * Abre o aviso de "as respostas estão esperando a janela abrir", uma vez por
 * canal enquanto durar o silêncio. Devolve quantos itens criou (0 = já havia um
 * aberto para este canal).
 *
 * Fire-and-forget no chamador: falha de telemetria nunca pode derrubar um turno
 * que já decidiu o que fazer com a mensagem do cliente.
 */
export async function avisarJanelaFechada(
  db: Queryable,
  input: AvisoDeJanelaInput,
): Promise<number> {
  // `sv-SE` e não `pt-BR`: o corpo do aviso é PERSISTIDO, e o produto tem duas
  // línguas — uma data gravada em português apareceria assim para quem escolheu
  // espanhol, e é o que `tests/unit/i18n-a-data-segue-o-idioma.test.ts` reprova.
  // `sv-SE` rende 'YYYY-MM-DD HH:mm', que é ISO-like e legível em qualquer
  // idioma. Mesmo precedente de `formatInTz` em `pacing/engine.ts`.
  const quando = new Intl.DateTimeFormat('sv-SE', {
    timeZone: input.timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(input.abertura);

  const porque = input.domingoDesligado
    ? `Este número está com **envio aos domingos desligado**, e a janela de horário é ${input.janela} ` +
      `(fuso ${input.timezone}).`
    : `A janela de envio deste número é ${input.janela} (fuso ${input.timezone}), e agora está fechada.`;

  const oQueFazer = input.domingoDesligado
    ? 'Se quiser que o agente responda aos domingos, ligue "Enviar aos domingos" em Conexões › Anti-ban.'
    : 'Não é preciso fazer nada: as respostas saem sozinhas na abertura.';

  const { rowCount } = await db.query(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
     -- 'warn', não 'warning': o CHECK de agent_inbox_items.severity só aceita
     -- info|warn|critical, e o valor errado faria o INSERT estourar em runtime —
     -- num caminho fire-and-forget, que engoliria o erro e deixaria o silêncio
     -- invisível de novo, que é exatamente o defeito que este arquivo conserta.
     select $1, 'other', 'warn', $2, $3, $4, $5
     where not exists (
       select 1 from agent_inbox_items
       where organization_id = $1 and ref_kind = $4 and ref_id = $5 and status = 'open'
     )`,
    [
      input.tenantId,
      'As respostas da IA estão esperando a janela de envio abrir',
      `${porque} Quem escrever agora recebe resposta a partir de ${quando}. ` +
        `Nenhuma mensagem se perde — os turnos ficam na fila e saem na abertura. ${oQueFazer}`,
      REF_KIND_JANELA,
      input.channelSessionId,
    ],
  );
  return rowCount ?? 0;
}

/**
 * Fecha o aviso quando a janela volta a estar aberta. Chamado no turno que
 * PASSA pelo gate — é onde se sabe, sem adivinhar, que o silêncio acabou.
 *
 * Devolve quantos avisos resolveu (0 no caso normal, que é não haver nenhum).
 */
export async function resolverAvisoDeJanela(
  db: Queryable,
  input: { tenantId: string; channelSessionId: string },
): Promise<number> {
  const { rowCount } = await db.query(
    `update agent_inbox_items
        set status = 'resolved', resolved_at = now()
      where organization_id = $1 and ref_kind = $2 and ref_id = $3 and status = 'open'`,
    [input.tenantId, REF_KIND_JANELA, input.channelSessionId],
  );
  return rowCount ?? 0;
}
