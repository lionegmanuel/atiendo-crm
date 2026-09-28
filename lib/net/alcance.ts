/**
 * Por que um serviço externo não foi alcançado — e por que a diferença importa.
 *
 * ─── O defeito que este arquivo existe para matar ────────────────────────────
 * `fetch` colapsa causas opostas numa única `TypeError: fetch failed`. Quem lê
 * só a mensagem não distingue "o endereço que me configuraram não existe" de "o
 * serviço caiu" — e, tendo que escrever UMA frase, escreve a segunda, que é a
 * hipótese simpática para quem configurou.
 *
 * Foi o que aconteceu com o transporte de mensagens em produção: o endereço
 * configurado não resolvia no DNS, e durante semanas o app respondeu "confirme
 * que o container está no ar" — mandando o dono reiniciar, toda vez, um
 * container que nunca tinha caído (medido: `restarts=0`, `Up 5 days`).
 * Endereço inexistente e serviço fora do ar pedem ações opostas: uma se conserta
 * na configuração, a outra no servidor. Uma frase só para as duas manda metade
 * das pessoas para o lugar errado, sempre.
 *
 * ─── Por que percorrer a cadeia de causas ────────────────────────────────────
 * O `code` real (`ENOTFOUND`, `ECONNREFUSED`) nunca está no erro de cima: o
 * undici embrulha o erro do socket em `cause`, e quando o host tem vários IPs
 * (A + AAAA) as tentativas viram um `AggregateError` cujos filhos é que carregam
 * o código. Ler só `erro.code` devolve `undefined` para TODOS os casos — um
 * instrumento que sempre responde "não sei" é indistinguível de um que sempre
 * responde "está tudo bem".
 */

/** O que impediu o alcance, no nível que muda a AÇÃO de quem lê. */
export type FalhaDeAlcance =
  /** DNS não resolve o host: o endereço configurado não existe. */
  | "endereco_nao_resolve"
  /** Resolveu e o host recusou ativamente: nada escuta naquela porta. */
  | "conexao_recusada"
  /** Rota inexistente até o host (rede/firewall o descarta). */
  | "host_inalcancavel"
  /** Conectou ou tentou, mas o tempo acabou antes da resposta. */
  | "tempo_esgotado"
  /** Chegou ao TLS e o certificado foi recusado. */
  | "tls_recusado"
  /** Falhou por algo que não sabemos classificar — e dizemos isso. */
  | "indeterminada";

const POR_CODIGO: Record<string, FalhaDeAlcance> = {
  ENOTFOUND: "endereco_nao_resolve",
  EAI_AGAIN: "endereco_nao_resolve",
  ECONNREFUSED: "conexao_recusada",
  EHOSTUNREACH: "host_inalcancavel",
  ENETUNREACH: "host_inalcancavel",
  ENETDOWN: "host_inalcancavel",
  ETIMEDOUT: "tempo_esgotado",
  ECONNRESET: "host_inalcancavel",
  UND_ERR_CONNECT_TIMEOUT: "tempo_esgotado",
  UND_ERR_HEADERS_TIMEOUT: "tempo_esgotado",
  UND_ERR_BODY_TIMEOUT: "tempo_esgotado",
  ABORT_ERR: "tempo_esgotado",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls_recusado",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls_recusado",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls_recusado",
  SELF_SIGNED_CERT_IN_CHAIN: "tls_recusado",
  CERT_HAS_EXPIRED: "tls_recusado",
};

/**
 * O texto do erro também carrega o código, e às vezes é só o que sobra: o nosso
 * próprio timeout de health check é um `Error("timeout after 3000ms")` sem
 * `code`, e um erro serializado (log, resposta de API, `String(err)`) perde
 * `cause` no caminho.
 */
const POR_TEXTO: Array<[RegExp, FalhaDeAlcance]> = [
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "endereco_nao_resolve"],
  [/ECONNREFUSED/i, "conexao_recusada"],
  [/EHOSTUNREACH|ENETUNREACH|ENETDOWN|ECONNRESET/i, "host_inalcancavel"],
  [/ETIMEDOUT|timeout|timed out|aborted/i, "tempo_esgotado"],
  [/certificate|self[- ]signed|ERR_TLS|CERT_/i, "tls_recusado"],
];

/** Profundidade máxima ao descer por `cause` — `cause` cíclico não trava aqui. */
const PROFUNDIDADE_MAX = 8;

function coletarCodigos(erro: unknown, restante: number, achados: string[]): void {
  if (restante <= 0 || erro === null || typeof erro !== "object") return;
  const e = erro as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string") achados.push(e.code);
  if (Array.isArray(e.errors)) {
    for (const filho of e.errors) coletarCodigos(filho, restante - 1, achados);
  }
  if (e.cause !== undefined) coletarCodigos(e.cause, restante - 1, achados);
}

function textoDe(erro: unknown): string {
  if (erro instanceof Error) {
    // A causa costuma ser onde mora o código; `String(Error)` não a inclui.
    const causa = (erro as { cause?: unknown }).cause;
    return causa === undefined ? erro.message : `${erro.message} ${String(causa)}`;
  }
  return typeof erro === "string" ? erro : String(erro ?? "");
}

/**
 * Classifica a falha. Aceita o erro cru (preferido — tem a cadeia de causas) ou
 * a mensagem já achatada, para os pontos que só recebem string.
 */
export function classificarFalhaDeAlcance(erro: unknown): FalhaDeAlcance {
  const codigos: string[] = [];
  coletarCodigos(erro, PROFUNDIDADE_MAX, codigos);
  for (const codigo of codigos) {
    const achado = POR_CODIGO[codigo];
    if (achado) return achado;
  }
  const texto = textoDe(erro);
  for (const [padrao, achado] of POR_TEXTO) {
    if (padrao.test(texto)) return achado;
  }
  return "indeterminada";
}

/**
 * A frase para quem não programa — e ela aponta ONDE mexer, porque essa é a
 * única diferença que o leitor precisa da classificação.
 *
 * `servico` entra por extenso, já com artigo ("o banco de dados", "o cache"),
 * para a frase servir a qualquer dependência sem virar template de placeholder —
 * e para este módulo, que é de rede, não precisar conhecer nenhuma delas.
 */
export function explicarFalhaDeAlcance(falha: FalhaDeAlcance, servico: string): string {
  switch (falha) {
    case "endereco_nao_resolve":
      return `O endereço configurado para ${servico} não existe — nem chegamos a tentar conectar. Isso é configuração, não o serviço: reveja o endereço nas variáveis de ambiente.`;
    case "conexao_recusada":
      return `O servidor de ${servico} foi encontrado, mas recusou a conexão: nada está atendendo naquela porta. Confirme que o serviço está no ar e que a porta configurada é a dele.`;
    case "host_inalcancavel":
      return `Não há caminho de rede até o servidor de ${servico}. Ele pode estar desligado ou bloqueado por firewall.`;
    case "tempo_esgotado":
      return `O servidor de ${servico} não respondeu a tempo. Pode estar sobrecarregado, ou o tráfego está sendo bloqueado no meio do caminho.`;
    case "tls_recusado":
      return `O certificado de segurança do endereço de ${servico} foi recusado. Confirme o certificado do domínio configurado.`;
    case "indeterminada":
      return `Não foi possível falar com ${servico}, e a causa não foi identificada.`;
  }
}

/**
 * O endereço que tentamos, sem nada que seja segredo: protocolo, host e porta.
 *
 * Existe porque o operador precisa ver PARA ONDE o sistema tentou ir — descobrir
 * que o endereço está errado sem poder lê-lo deixa o diagnóstico pela metade. O
 * caminho e a query ficam de fora: é neles que credencial viaja quando alguém a
 * põe na URL, e este valor é feito para ser exibido.
 */
export function alvoDe(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
  } catch {
    return "(endereço inválido)";
  }
}
