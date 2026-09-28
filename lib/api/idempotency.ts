/**
 * Idempotência de POST no nível da rota — reserva, replay e conflito.
 *
 * O contrato está em `docs/specs/01-spec-platform-base.md` §7.3 e em
 * `CLAUDE.md`: POST de criação aceita `Idempotency-Key: <uuid>`; mesma chave
 * com o mesmo corpo devolve a resposta gravada; mesma chave com corpo
 * diferente devolve 409 `idempotency_conflict`; a janela é de 24h.
 *
 * Até aqui havia DUAS implementações e nenhuma compartilhada:
 * `admin/tenants` usa RPC transacional e `lgpd/requests/[id]/approve` faz
 * leitura e gravação no próprio handler. Este arquivo é a terceira, e a
 * primeira reutilizável. `lib/api/README.md` já anunciava um
 * `lib/api/idempotency.ts` que não existia.
 *
 * ── O que este helper garante ────────────────────────────────────────────────
 * 1. MESMA chave + MESMO corpo: devolve a resposta gravada, **sem reexecutar**.
 * 2. MESMA chave + corpo DIFERENTE: devolve `conflito`, para o chamador
 *    responder 409 `idempotency_conflict` — a chave é que está errada.
 * 3. Recibo VENCIDO não conta: a mesma chave depois de 24h é operação nova,
 *    como a spec promete.
 * 4. DUAS requisições SIMULTÂNEAS com a mesma chave: o efeito acontece UMA
 *    vez. A chave é reservada ANTES do efeito e quem perde a corrida recebe
 *    `em_curso` (409 `idempotency_in_progress` na rota): mesmo pedido, mesma
 *    chave, e retentar resolve — trocar a chave, aqui, é que seria erro.
 *
 * ── Como a corrida é fechada ─────────────────────────────────────────────────
 * A reserva é a própria linha de `public.idempotency_keys`, gravada antes do
 * efeito com `status_code` e `response_body` NULOS
 * (`supabase/migrations/20260919120000_0321_recibo_de_idempotencia_em_curso.sql`).
 * O índice único `idempotency_keys_organization_id_key_endpoint_key` decide
 * quem executa: o segundo INSERT leva 23505 e não executa nada. Depois do
 * efeito, a MESMA linha recebe `status_code` + `response_body` e passa a valer
 * 24h — o recibo terminal, que é o que o replay lê.
 *
 * Antes da 0321 as duas colunas eram `NOT NULL` e a tabela só sabia
 * representar recibo terminal: entre a leitura e a gravação não havia onde
 * gravar "esta chave está em curso", então duas requisições simultâneas liam
 * vazio as duas e o efeito acontecia duas vezes.
 *
 * Não há transação aqui, e não pode haver: o efeito é código de aplicação
 * (escrita no banco por outra rota, e-mail, provedor externo), que não cabe na
 * transação do recibo. O caminho transacional do repositório é outro e já
 * existe para efeito em SQL — `fn_create_tenant_with_owner`
 * (`baseline.sql:18217`) e `fn_reserve_channel_connection`
 * (`baseline.sql:22566`). O que a reserva dá, aqui, é o começo atômico: o
 * efeito roda uma vez por chave, e o "ainda não gravei" deixa de ser invisível
 * para a segunda requisição.
 *
 * ── O hash na coluna `bytea` ────────────────────────────────────────────────
 * `request_hash` é `bytea` (`supabase/baseline.sql:1554`), e as funções SQL do
 * repo a escrevem decodificada (`decode(p_hash, 'hex')`). Escrever o hex CRU
 * não estourava — o Postgres o lia como o formato `escape` e gravava 64 bytes
 * ASCII —, mas a releitura volta como `\x…` (PostgREST) ou `Buffer` (driver
 * `pg`), então a comparação nunca casava e TODO replay virava 409
 * `idempotency_conflict`. As duas pontas da fronteira estão em `hashDaColuna`
 * e `hashLido`, e a medição está em
 * `tests/invariants/idempotencia-reserva-antes-do-efeito.test.ts`.
 *
 * ── Reserva vencida ─────────────────────────────────────────────────────────
 * A reserva vale `JANELA_DA_RESERVA_MS` (60s — o efeito é uma escrita, não um
 * job). Se a requisição morrer antes de gravar o recibo terminal, a reserva
 * vence e a chave volta a ser de quem chegar depois: a linha vencida é
 * reescrita como reserva nova, em vez de trancar a chave para sempre. O preço
 * é conhecido e está declarado: se o efeito ainda estiver rodando quando a
 * reserva vencer, o novo dono pode executá-lo de novo. É por isso que a janela
 * da reserva (60s) e o TTL do recibo (24h) são números diferentes.
 *
 * ── Falha ao gravar ─────────────────────────────────────────────────────────
 * Se o efeito já aconteceu e a gravação do recibo falha, o desfecho devolvido
 * é `executou` — não erro. Devolver erro faria o cliente retentar e DUPLICAR o
 * efeito, que é exatamente o que a idempotência existe para evitar. A gravação
 * é, portanto, best-effort, e quem chama pode registrar o aviso. O mesmo vale
 * para a reserva: erro que não seja 23505 não impede o efeito — nesse ponto o
 * comportamento é o de antes desta mudança, sem piora.
 *
 * O caso inverso — o EFEITO lança — libera a reserva e propaga o erro: não há
 * recibo de operação que falhou, e a retentativa com a mesma chave executa em
 * vez de receber `em_curso` de algo que já não está acontecendo.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Chave do header, nas duas grafias que o HTTP aceita. */
export function chaveDaRequisicao(req: Request): string | null {
  return req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
}

/** 24h — o TTL que a spec 01 §7.3 fixa, e o mesmo default da coluna. */
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Quanto tempo uma RESERVA (linha sem recibo, efeito em curso) tranca a chave.
 * Curto de propósito: é o teto do efeito, não a janela da idempotência.
 */
export const JANELA_DA_RESERVA_MS = 60 * 1000;

export type Recibo = {
  /** `bytea` no banco: chega como o literal `\x…` (PostgREST) ou como `Buffer` (`pg`). */
  request_hash: unknown;
  /** `null` = reserva, efeito em curso; recibo terminal sempre tem número. */
  status_code: number | null;
  response_body: unknown;
};

/** A linha crua da tabela: `id` e `expires_at` são o que decide a retomada. */
type LinhaDaChave = Recibo & { id: string; expires_at: string };

/**
 * Hash do corpo da requisição. É o que distingue "mesma operação" de "mesma
 * chave, operação diferente" — e a única coisa que autoriza devolver a
 * resposta gravada.
 *
 * A serialização dos campos é ordenada: `JSON.stringify` depende da ordem das
 * chaves, e dois corpos iguais com ordem diferente não podem virar conflito.
 */
export function hashDoCorpo(corpo: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(ordenar(corpo)))
    .digest("hex");
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      saida[chave] = ordenar((valor as Record<string, unknown>)[chave]);
    }
    return saida;
  }
  return valor;
}

/**
 * O hash no formato da COLUNA (`bytea`): o literal `\x…`, que é o que o
 * PostgREST aceita e o mesmo valor que ele devolve na leitura. É também a
 * forma que as funções SQL do repo usam (`decode(p_hash, 'hex')`).
 */
export function hashDaColuna(hashHex: string): string {
  return `\\x${hashHex}`;
}

/**
 * O hash como ele VOLTA da coluna `bytea` — normalizado para hex minúsculo,
 * porque os dois transportes do repo o devolvem de formas diferentes: o
 * PostgREST, como o literal `\x…`; o driver `pg` (adaptador dos invariantes),
 * como `Buffer` dos bytes. Formato desconhecido devolve `null`, e `null` não
 * casa com hash nenhum: erra para o lado do conflito, nunca do replay.
 */
export function hashLido(valor: unknown): string | null {
  if (typeof valor === "string") {
    return (valor.startsWith("\\x") ? valor.slice(2) : valor).toLowerCase();
  }
  if (Buffer.isBuffer(valor)) return valor.toString("hex");
  return null;
}

export type DesfechoIdempotente<T> =
  | { tipo: "executou"; resposta: T; status: number }
  /** A resposta gravada da primeira execução, devolvida sem reexecutar. */
  | { tipo: "replay"; resposta: T; status: number }
  /** Mesma chave, corpo diferente: o chamador responde 409. */
  | { tipo: "conflito" }
  /**
   * Mesma chave, mesmo corpo, primeira execução AINDA em curso: a chave está
   * reservada e a resposta ainda não existe, então não há o que devolver nem
   * por que reexecutar. O chamador responde 409 `idempotency_in_progress`.
   */
  | { tipo: "em_curso" };

export type EntradaDaIdempotencia<T> = {
  /** Cliente Supabase com sessão. A policy `idempotency_tenant` cobre a org. */
  db: SupabaseClient;
  organizationId: string;
  endpoint: string;
  chave: string;
  /** O corpo já validado, que define a identidade da operação. */
  corpo: unknown;
  /** O efeito. Só é chamado por quem conseguir reservar a chave. */
  executar: () => Promise<{ resposta: T; status: number }>;
  /** Relógio injetado — o repo testa janela de tempo assim, não com sleep. */
  agora?: () => Date;
};

/** As colunas que a linha precisa devolver; nenhuma consulta pede menos que isto. */
const COLUNAS = "id, request_hash, status_code, response_body, expires_at";

export async function comIdempotencia<T>(
  entrada: EntradaDaIdempotencia<T>,
): Promise<DesfechoIdempotente<T>> {
  const { db, organizationId, endpoint, chave, corpo, executar } = entrada;
  const agora = entrada.agora ?? (() => new Date());
  const hash = hashDoCorpo(corpo);

  /**
   * Lê a linha da chave. `somenteVivo` é o filtro da janela: com ele, reserva
   * vencida e recibo vencido NÃO contam (a spec promete operação nova depois de
   * 24h); sem ele, a leitura é crua, e é assim que uma linha vencida é
   * reconhecida como vencida em vez de invisível.
   */
  const lerLinha = async (somenteVivo: boolean): Promise<LinhaDaChave | null> => {
    const consulta = db
      .from("idempotency_keys")
      .select(COLUNAS)
      .eq("organization_id", organizationId)
      .eq("key", chave)
      .eq("endpoint", endpoint);
    const comJanela = somenteVivo
      ? consulta.gt("expires_at", agora().toISOString())
      : consulta;
    const { data } = await comJanela.maybeSingle();
    return (data as LinhaDaChave | null) ?? null;
  };

  /**
   * Recibo terminal dentro da janela → replay ou conflito; linha com
   * `status_code` nulo → reserva em curso, que a segunda requisição não pode
   * atropelar.
   */
  const classificar = (linha: LinhaDaChave): DesfechoIdempotente<T> => {
    if (hashLido(linha.request_hash) !== hash) return { tipo: "conflito" };
    if (linha.status_code === null) return { tipo: "em_curso" };
    return { tipo: "replay", resposta: linha.response_body as T, status: linha.status_code };
  };

  const anterior = await lerLinha(true);
  if (anterior) return classificar(anterior);

  const expiraEm = new Date(agora().getTime() + JANELA_DA_RESERVA_MS).toISOString();
  const { error: erroDaReserva } = await db.from("idempotency_keys").insert({
    organization_id: organizationId,
    key: chave,
    endpoint,
    request_hash: hashDaColuna(hash),
    status_code: null,
    response_body: null,
    expires_at: expiraEm,
  });

  // 23505: alguém passou pela leitura e reservou a chave primeiro. É o índice
  // único fazendo o trabalho dele — esta requisição NÃO executa o efeito.
  if (erroDaReserva && (erroDaReserva as { code?: string }).code === "23505") {
    const linha = await lerLinha(false);
    // A linha existia (o 23505 veio dela) e não está mais: é expurgo de
    // expirados no meio do caminho. Retentar resolve; 500, não.
    if (!linha) return { tipo: "em_curso" };

    if (new Date(linha.expires_at).getTime() > agora().getTime()) return classificar(linha);

    // Linha VENCIDA: recibo vencido não conta (o efeito roda de novo, como a
    // spec promete) e reserva vencida é de quem chegar depois. Nos dois casos a
    // linha velha é reescrita como reserva nova — com o `expires_at` lido como
    // bilhete, para não roubar a reserva de quem tomou posse entre a leitura e
    // esta gravação.
    const { data: tomouPosse } = await db
      .from("idempotency_keys")
      .update({
        request_hash: hashDaColuna(hash),
        status_code: null,
        response_body: null,
        expires_at: expiraEm,
      })
      .eq("id", linha.id)
      .eq("expires_at", linha.expires_at)
      .select("id")
      .maybeSingle();
    if (!tomouPosse) return { tipo: "em_curso" };
  }

  let efeito: { resposta: T; status: number };
  try {
    efeito = await executar();
  } catch (erro) {
    // O efeito falhou: a reserva é LIBERADA (vence agora) antes de propagar.
    // Viva, ela responderia "em curso" por 60s a uma retentativa de algo que
    // não está acontecendo — e o contrato de quem chama é que falha propaga
    // sem deixar rastro. Vencida, a próxima requisição com esta chave a
    // retoma pelo caminho da linha vencida, acima.
    await db
      .from("idempotency_keys")
      .update({ expires_at: agora().toISOString() })
      .eq("organization_id", organizationId)
      .eq("key", chave)
      .eq("endpoint", endpoint)
      .eq("request_hash", hashDaColuna(hash));
    throw erro;
  }
  const { resposta, status } = efeito;

  // Recibo terminal NA MESMA linha da reserva: é ele que a próxima requisição
  // com esta chave vai ler (por 24h) em vez de reexecutar. O filtro por
  // `request_hash` é o que impede uma requisição de gravar o recibo de outra
  // operação — inclusive depois de uma retomada.
  await db
    .from("idempotency_keys")
    .update({
      status_code: status,
      response_body: resposta as unknown as Record<string, unknown>,
      expires_at: new Date(agora().getTime() + TTL_MS).toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("key", chave)
    .eq("endpoint", endpoint)
    .eq("request_hash", hashDaColuna(hash));

  return { tipo: "executou", resposta, status };
}
