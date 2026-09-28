/**
 * O caminho de VOLTA de um canal: reconectar é ressuscitar.
 *
 * ─── Por que isto é uma função, e não `archived_at: null` em cada handler ────
 * O arquivamento (migration 0106) fez `archived_at` virar a chave que decide se
 * o canal existe: o webhook descarta o que chega nele, o ingest não cria
 * conversa, os seletores não o oferecem e o envio recusa. Enquanto isso, os
 * caminhos que RELIGAM um canal — reconectar o oficial, retomar o pareamento
 * pelo onboarding — escreviam status, credencial e número e deixavam a linha
 * arquivada. O resultado é o pior estado possível: a tela diz "conectado" e o
 * canal está permanentemente invisível e mudo. Quem religa tem que desarquivar,
 * e desarquivar num lugar só é o que impede a próxima reconexão de esquecer.
 *
 * ─── Por que a AUDITORIA sai daqui, e não de cada chamador ──────────────────
 * `channel.reactivated` é a contraparte de `channel.archived`: sem ela quem
 * audita vê um canal excluído entregando mensagem e não acha o momento em que
 * ele reviveu. Enquanto o emissor foi o chamador, isso valeu para UM dos dois
 * caminhos de volta — o oficial auditava, a retomada do pareamento ressuscitava
 * calada. A guarda não é lembrar melhor: é o ator ser PARÂMETRO OBRIGATÓRIO
 * daqui, para uma ressurreição nova não conseguir nascer muda (não compila sem
 * dizer quem pediu).
 *
 * Pelo mesmo motivo o estado anterior (`archivedAt`) entra como parâmetro em vez
 * de ser relido aqui: quem chama JÁ leu a linha para decidir o que fazer com
 * ela, e uma segunda leitura abriria janela entre o que se auditou e o que se
 * escreveu. Linha que não estava arquivada não gera evento — atualizar não é
 * ressuscitar, e auditoria que dispara sempre para de significar alguma coisa.
 *
 * ─── Por que tolera a coluna ausente ────────────────────────────────────────
 * Um clone que subiu o código sem aplicar a 0100 não tem `archived_at`. Gravar a
 * coluna direto ali derrubaria a reconexão inteira (a tela do canal oficial
 * pararia de conectar), e por um motivo que nem existe naquele banco: sem a
 * coluna, nada está arquivado, então o patch sem ela é o patch exato. A
 * detecção é a mesma de `./archived` — estreita, pelo nome da coluna na
 * mensagem de erro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import { ARCHIVED_AT, queryTolerantToMissingArchived, type DbErrorLike } from "./archived";

/** O canal, sempre por (organização, id) — tenancy explícita mesmo sob o admin. */
export interface ChannelSessionTarget {
  organizationId: string;
  channelSessionId: string;
  /**
   * `archived_at` como o chamador ACABOU de ler, antes deste update. É o que
   * separa ressuscitar de só atualizar — e, portanto, o que decide se há evento
   * de auditoria. `undefined` é o clone sem a coluna: lá nada está arquivado,
   * então nada ressuscita.
   */
  archivedAt: string | null | undefined;
}

/** Quem pediu a volta. Sem ator, a entrada de auditoria não serviria de trilha. */
export interface ChannelReactivationActor {
  userId: string;
  requestId?: string | null;
  /** O que faz quem lê o histórico reconhecer o canal (provider, número…). */
  metadata?: Record<string, unknown>;
}

/**
 * Aplica `patch` ao canal, o traz de volta à vida no MESMO update e registra a
 * ressurreição.
 *
 * Um update só, e não "patch + desarquiva depois": entre os dois haveria uma
 * janela em que o canal está ativo com a credencial antiga (ou arquivado com a
 * nova), e é justamente aí que o webhook e o envio consultam.
 *
 * O chamador decide o resto do estado — status, credencial, número —, porque
 * "voltar" significa coisas diferentes num canal oficial (a credencial nova
 * chegou validada) e num canal pareado por QR (o número só se sabe depois do
 * escaneamento). O que NÃO é do chamador é lembrar de desarquivar nem de
 * auditar.
 *
 * `reactivated` no retorno é o que de fato aconteceu (linha arquivada + escrita
 * aceita), não a intenção — é por ele que o teste distingue "ressuscitou" de
 * "atualizou uma linha que já estava viva".
 */
export async function reactivateChannelSession(
  db: SupabaseClient,
  target: ChannelSessionTarget,
  patch: Record<string, unknown>,
  actor: ChannelReactivationActor,
): Promise<{ error: DbErrorLike | null; schemaOutdated: boolean; reactivated: boolean }> {
  const aplicar = (corpo: Record<string, unknown>) =>
    db
      .from("channel_sessions")
      .update(corpo)
      .eq("organization_id", target.organizationId)
      .eq("id", target.channelSessionId);

  const { error, schemaOutdated } = await queryTolerantToMissingArchived(
    () => aplicar({ ...patch, [ARCHIVED_AT]: null }),
    () => aplicar(patch),
  );

  // Escrita recusada não ressuscitou nada: auditar aqui inventaria uma volta que
  // o banco negou.
  const reactivated = Boolean(target.archivedAt) && !error;
  if (reactivated) {
    // Fire-and-forget, como toda auditoria do repo: falha de trilha não pode
    // derrubar a reconexão de quem está com o número fora do ar.
    void audit({
      action: "channel.reactivated",
      actorUserId: actor.userId,
      organizationId: target.organizationId,
      resourceType: "channel_session",
      resourceId: target.channelSessionId,
      requestId: actor.requestId ?? null,
      metadata: { ...(actor.metadata ?? {}), archived_at: target.archivedAt },
    });
  }

  return { error: error ?? null, schemaOutdated, reactivated };
}
