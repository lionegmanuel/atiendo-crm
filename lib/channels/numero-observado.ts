/**
 * Qual número o transporte está mesmo atendendo nesta conexão.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 * A rota de saúde da conexão gravava o número assim:
 *
 *     if (jid && !phoneNumber) phoneNumber = jid.replace(/@.*\/, "");
 *
 * — só quando a coluna ainda estava VAZIA. O primeiro pareamento gravava, e
 * dali em diante o valor era imutável. Re-parear a conexão com OUTRO aparelho é
 * exatamente o que o dono faz quando o WhatsApp cai, e o banco seguia dizendo o
 * número antigo para sempre.
 *
 * Medido numa instalação real: a conexão de produção atendia `551148633324`, e
 * o banco dizia `553198966398` — o número de um pareamento anterior, de outra
 * organização. Os 23 avisos abertos na Central nomeavam o número errado.
 *
 * Isso não é cosmético. `health.ts` escolhe o apelido do aviso justamente para
 * responder "QUAL conexão caiu?" — a primeira pergunta de quem lê. Com o dado
 * errado, o aviso manda o operador pegar o celular errado, e a impressão que
 * fica é "esse negócio vive caindo e eu nunca consigo reconectar".
 *
 * ─── Por que não basta gravar sempre ────────────────────────────────────────
 *
 * Porque o `me` do WAHA é o do ÚLTIMO pareamento que vingou, e ele continua
 * sendo servido enquanto a sessão está fora do ar. Medido no mesmo dia: com
 * duas sessões em `FAILED`, a API devolvia o MESMO `me` para as duas — o de uma
 * delas. Gravar isso trocaria um número errado por outro, e ainda por cima
 * poderia colidir com a trava de número único do banco.
 *
 * Só `WORKING` é observação: é o estado em que o transporte fala do aparelho
 * que ele está de fato atendendo agora.
 */

/** O estado em que o `me` do transporte descreve o aparelho de verdade. */
const STATUS_EM_QUE_O_NUMERO_VALE = "WORKING";

export function numeroObservadoDaSessao(input: {
  /** JID como o transporte devolve: `5511999998888@c.us`. */
  jid: string | null | undefined;
  /** Status lido AGORA, não o que estava no banco. */
  statusAoVivo: string | null | undefined;
  /** O que já está gravado — devolvido de volta quando não há observação boa. */
  gravado: string | null;
}): string | null {
  if (!input.jid) return input.gravado;
  if ((input.statusAoVivo ?? "").toUpperCase() !== STATUS_EM_QUE_O_NUMERO_VALE) {
    return input.gravado;
  }
  const numero = input.jid.replace(/@.*/, "").trim();
  // JID sem parte local (`@c.us`) não descreve aparelho nenhum: manter o que
  // está gravado é melhor que apagar o único dado que a tela tinha.
  return numero || input.gravado;
}
