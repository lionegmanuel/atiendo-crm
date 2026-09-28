/**
 * A PODA DO HISTÓRICO DE LEADS CAPTADOS.
 *
 * ─── Por que ela é DIFERENTE da poda do arquivo forense ─────────────────────
 *
 * `webhook_events_log` é esvaziado em 7 dias e apagado em 90, porque lá o
 * corpo cru é 97% do peso e ninguém o lê depois de uma semana. Aqui é o
 * oposto: a linha É o produto — o dono do negócio abre a aba "Leads recebidos"
 * para responder "quem chegou, com que dados, de onde", e a resposta que
 * interessa costuma ser de meses atrás ("de qual campanha vieram os clientes
 * que fecharam?").
 *
 * Então NÃO existe o passo de "esvaziar mantendo a linha": ou o registro serve
 * inteiro, ou não serve. Um horizonte só, longo.
 *
 * ─── O tamanho, medido e não estimado no escuro ─────────────────────────────
 *
 * Uma linha por formulário preenchido. As colunas pesadas são `fields` e `utm`
 * (jsonb do formulário, cortado em 60 campos × 2.000 caracteres por
 * `limitarCampos`), mais `user_agent` (500). O caso realista fica em ~1 kB:
 *
 *   300 leads/dia × 365 dias × ~1 kB ≈ 110 MB/ano
 *
 * Não é o arquivo bruto (23 MB/DIA, medido), mas também não é nada num plano de
 * 500 MB — que é onde a maioria dos clones vive. Daí o default de 365 dias:
 * cobre o ano fiscal inteiro e ainda deixa o banco caber.
 *
 * ─── O piso, e por que ele NÃO é um mecanismo novo ──────────────────────────
 *
 * A política (padrão, piso, e a frase de aviso quando o número do operador não
 * vale como escrito) vem de `lib/retencao/politica.ts` — o mesmo módulo que a
 * poda da fila e o expurgo da auditoria usam. Um segundo mecanismo de piso aqui
 * seria duplicação sem fonte declarada, e as duas cópias divergiriam no
 * primeiro ajuste.
 *
 * O que este arquivo acrescenta é o LOG do aviso. `interpretarRetencao` devolve
 * a frase; jogá-la fora faria a poda elevar o número em SILÊNCIO, e o operador
 * que escreveu `LEAD_CAPTURE_RETENTION_DAYS=1` descobriria pela ausência de
 * efeito — falha fechada na ação e fechada também na informação, que é o pior
 * dos dois mundos.
 *
 * ─── A ordem e o erro, na MESMA régua das podas irmãs (issue #1721) ─────────
 *
 * Esta poda nasceu no molde antigo e ficou nele em dois pontos, ambos medidos
 * contra a décima poda do `data-retention`, que a casa já corrigiu no #1719:
 *
 *   1. o DELETE ia `.limit(lote)` SEM `order`. O PostgREST 12.2 recusa isso
 *      com 400 PGRST109 (medido no v12.2.12 pelo mantenedor; com `order=id`
 *      volta 200) — e, aqui, a recusa virava `apagadas: 0`. A ordem também é o
 *      que torna a drenagem DETERMINÍSTICA: sem `order`, cada lote apaga um
 *      subconjunto arbitrário, e a sequência de lotes deixa de ser repetível.
 *      A coluna é `id`, ASCENDENTE — a mesma da décima poda, e pela mesma
 *      razão: é a chave primária, logo a ordem é estável e o recorte é
 *      repetível, e é a coluna que casa com o índice de `received_at` sem
 *      exigir que o planner troque de caminho;
 *   2. o erro do DELETE era ENGOLIDO (`logger.warn` + `apagadas: 0`). O
 *      `warn` é a evidência, não o aviso: a resposta do cron dizia "não havia
 *      nada vencido", indistinguível de uma instalação em dia, e o único sinal
 *      vivia num log dentro do contêiner, atrás de um `curl` que joga tudo
 *      para /dev/null. Agora a falha SOBE, como em `drenar`
 *      (`app/api/v1/cron/data-retention/route.ts`): quem chama involve a
 *      captação num `try` próprio, escreve a linha `retention.sweep_run` com
 *      `falhou: true` e responde 500. O que se perde é UMA rodada de um
 *      expurgo — o que já foi apagado no banco não volta atrás, porque cada
 *      lote fecha a própria transação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import {
  interpretarRetencao,
  RETENCAO_CAPTACAO_DIAS_PADRAO,
  RETENCAO_CAPTACAO_DIAS_PISO,
} from "@/lib/retencao/politica";

/** Lote por rodada. Mesmo tamanho da poda do arquivo, pelo mesmo motivo: nunca ser dono de uma trava longa. */
export const LOTE_PADRAO_DA_CAPTACAO = 500;

export interface ResultadoDaPodaDeCaptacao {
  apagadas: number;
  /** `true` quando o lote encheu — ainda há fila para a próxima rodada. */
  temMais: boolean;
  /** Os dias de fato aplicados, depois do piso. A tela/log mostra o que VALEU. */
  diasAplicados: number;
}

export async function podarHistoricoDeCaptacao(
  admin: SupabaseClient,
  opcoes: { diasBrutos: string | undefined; lote?: number },
): Promise<ResultadoDaPodaDeCaptacao> {
  const lote = opcoes.lote ?? LOTE_PADRAO_DA_CAPTACAO;
  const politica = interpretarRetencao(opcoes.diasBrutos, {
    chave: "LEAD_CAPTURE_RETENTION_DAYS",
    padrao: RETENCAO_CAPTACAO_DIAS_PADRAO,
    piso: RETENCAO_CAPTACAO_DIAS_PISO,
  });
  // O aviso é a metade que quase se perde: sem ele, quem escreveu um número que
  // não valeu descobre pela ausência de efeito, meses depois.
  if (politica.aviso !== null) {
    logger.warn("[retencao-captacao] o valor configurado não foi usado como escrito", {
      detail: politica.aviso,
    });
  }
  const dias = politica.dias;
  const limite = new Date(Date.now() - dias * 86_400_000).toISOString();

  // `received_at` é a coluna do índice `webhook_lead_captures_poda_idx`, criado
  // com este predicado em mente (migration 0174). Sem filtro de organização de
  // propósito: a poda varre pela ponta mais velha e não sabe escolher tenant —
  // é o que a torna incapaz de ser usada como apagador dirigido.
  const { data, error } = await admin
    .from("webhook_lead_captures")
    .delete()
    .lt("received_at", limite)
    .select("id")
    // O `order` ANTES do `limit` (issue #1721), na MESMA coluna e na mesma
    // direção da décima poda do `data-retention`: `id` ascendente. Duas
    // propriedades, e as duas importam. A PRIMEIRA é o que o PostgREST 12.2
    // exige: `limit` sem `order` num DELETE volta 400 PGRST109, e sem esta
    // linha a poda da captação nunca apaga nada em nenhum clone novo. A
    // SEGUNDA é a drenagem: sem ordem o banco escolhe um subconjunto
    // arbitrário a cada lote, então duas rodadas com o mesmo backlog não
    // apagam as mesmas linhas e a sequência de lotes não é reproduzível.
    .order("id")
    .limit(lote);

  if (error) {
    // A falha SOBE — o mesmo caminho de `drenar`
    // (`app/api/v1/cron/data-retention/route.ts`). O `warn` que vivia aqui
    // dizia a causa e devolvia `apagadas: 0`, que na resposta do cron é
    // indistinguível de "não havia nada vencido": um banco que parou de
    // aceitar o DELETE ficava indistinguível de um banco em dia, e o sinal
    // morava num log de contêiner atrás de um `curl` que joga tudo para
    // /dev/null. Quem chama pega a exceção num `try` PRÓPRIO — o que já
    // foi apagado no arquivo forense não se perde com ela, cada lote fecha a
    // sua transação — e responde 500 com a linha `falhou: true` na trilha.
    throw new Error(`webhook_lead_captures: ${error.message}`);
  }

  const apagadas = (data ?? []).length;
  return { apagadas, temMais: apagadas >= lote, diasAplicados: dias };
}
