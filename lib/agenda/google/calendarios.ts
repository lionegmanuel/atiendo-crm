/**
 * Quem é o dono da agenda que acabou de ser autorizada — e em que fuso ela vive.
 *
 * ─── Por que isto existe, e por que são DUAS respostas numa chamada ───────
 *
 * `calendar_connections.account_email` faz parte da chave única
 * (`organization_id, user_id, provider, account_email`): sem ela não há como
 * saber se a pessoa reconectou a MESMA conta ou plugou uma segunda. E o fuso do
 * calendário é o que `doEventoDoGoogle` exige para ler evento de dia inteiro,
 * que chega sem fuso nenhum.
 *
 * As duas saem do calendário primário, numa chamada só. É por isso que não
 * pedimos os escopos `userinfo.email`/`userinfo.profile`: o id do calendário
 * primário É o e-mail da conta, e `calendar.readonly` já cobre. Cada linha a
 * menos na tela de consentimento é uma chance a menos de a pessoa desmarcar algo
 * e a conexão nascer quebrada.
 *
 * ─── Não lança, pelo mesmo motivo do `token.ts` ───────────────────────────
 *
 * Devolve uma leitura. Quem chama transforma em redirect com motivo — este
 * caminho roda dentro do callback do OAuth, que é retorno de navegador.
 */

const ENDERECO_DO_PRIMARIO = "https://www.googleapis.com/calendar/v3/calendars/primary";
const PRAZO_MS = 10_000;

export interface ContaDaAgenda {
  /** O id do calendário primário, que é o e-mail da conta. */
  email: string;
  /** IANA. `doEventoDoGoogle` precisa dele para ler evento de dia inteiro. */
  fuso: string | null;
}

export type LeituraDaConta =
  | { ok: true; conta: ContaDaAgenda }
  /** `erro` é o objeto cru do Google — passe a `classificarErroDoGoogle`. */
  | { ok: false; erro: unknown; detalhe: string };

export async function contaDaAgendaPrimaria(accessToken: string): Promise<LeituraDaConta> {
  let resposta: Response;
  try {
    resposta = await fetch(ENDERECO_DO_PRIMARIO, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: "no-store",
    });
  } catch (erro) {
    return { ok: false, erro, detalhe: erro instanceof Error ? erro.message : String(erro) };
  }

  let bruto: unknown;
  try {
    bruto = await resposta.json();
  } catch {
    return {
      ok: false,
      erro: { status: resposta.status },
      detalhe: `HTTP ${resposta.status} com corpo ilegível`,
    };
  }

  if (!resposta.ok) {
    // O corpo cru do Google (`{ error: { code, errors[] } }`) vai inteiro para
    // quem classifica — é a forma que `classificarErroDoGoogle` aprendeu a ler
    // depois de a revisão fria mostrar que ela não lia.
    return { ok: false, erro: bruto, detalhe: `HTTP ${resposta.status}` };
  }

  const corpo = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const email = typeof corpo.id === "string" ? corpo.id.trim() : "";
  if (!email) {
    // Sem o e-mail não dá para gravar a conexão: ele é parte da chave única, e
    // gravar com string vazia faria duas contas diferentes colidirem numa só.
    return { ok: false, erro: bruto, detalhe: "calendário primário sem `id`" };
  }

  const fuso = typeof corpo.timeZone === "string" && corpo.timeZone.trim() ? corpo.timeZone.trim() : null;
  return { ok: true, conta: { email, fuso } };
}
