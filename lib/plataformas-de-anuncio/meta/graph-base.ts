/**
 * O HOST DA GRAPH DO EIXO DE ANÚNCIO — um lugar só, dentro da SUA fronteira.
 *
 * ─── Por que esta cópia e não a do canal ─────────────────────────────────────
 *
 * O canal de mensagem e a conta de anúncios são duas credenciais com ciclos de
 * vida diferentes, falando com a mesma plataforma. `lib/graph-version.ts` já
 * registra essa decisão: os dois eixos usam a MESMA versão, de propósito, mas
 * NENHUM herda a variável do outro. Aqui é igual, e por três razões medidas:
 *
 * 1. **A fronteira.** `scripts/lint-channels.ts` só libera nome de provider
 *    dentro de `lib/channels/` e `lib/plataformas-de-anuncio/`. Um util na raiz
 *    seria um terceiro lugar que nomeia o host, e a feature passaria a poder
 *    falar com a plataforma de anúncios sem passar por esta fronteira.
 * 2. **O override.** Uma instalação pode apontar o canal para um recetor de
 *    prova em tela e o anúncio para a produção (ou o contrário) sem que uma
 *    variável mate a outra. Quem aponta o canal para `127.0.0.1` para provar a
 *    jornada de envio não pode, ao mesmo tempo, estar reportando conversão de
 *    venda para o vazio.
 * 3. **A conta.** A conta de anúncios é do cliente e a credencial vem por
 *    organização; o canal oficial é da instalação. Um knob único seria um
 *    botão que muda o destino de duas contas diferentes ao mesmo tempo.
 *
 * O portão de validação é o MESMO do canal, pelas mesmas quatro medidas: base
 * absoluta `http`/`https`, barra final aparada, recusa que fecha na ação (host
 * real) e abre no log, e `http` em produção só para destino interno — o token
 * deste eixo viaja no mesmo cabeçalho, e a variável é de operador. Ver
 * `lib/channels/meta/graph-base.ts` para a justificativa de cada regra — aqui ela
 * é replicada, não importada, pela fronteira.
 */
import { isIPv4, isIPv6 } from "node:net";

import { VERSAO_PADRAO_DA_GRAPH } from "@/lib/graph-version";

/** O host real da Meta para o eixo de anúncio. */
export const HOST_PADRAO_DA_GRAPH_DE_ANUNCIO = "https://graph.facebook.com";

/** A variável deste eixo. Nome próprio, e a razão está no cabeçalho. */
const CHAVE = "META_ADS_GRAPH_BASE_URL";

/**
 * A base com a versão — `https://graph.facebook.com/v22.0`.
 *
 * A VERSÃO é a constante do eixo (`VERSAO_PADRAO_DA_GRAPH`, a MESMA que
 * `conversions.ts` fixava), e não a função `graphVersion()` do canal: o anúncio
 * não herda a variável do canal de mensagem, por decisão já escrita em
 * `lib/graph-version.ts`. Subir de versão é uma edição deliberada num arquivo só,
 * e a razão está no cabeçalho de `insights.ts`: campo válido some entre versões
 * sem aviso.
 */
export function baseDaGraphDeAnuncio(): string {
  return `${hostDaGraphDeAnuncio()}/${VERSAO_PADRAO_DA_GRAPH}`;
}

/** Só o host, para quem monta a URL com `new URL` e não quer caminho dentro. */
export function hostDaGraphDeAnuncio(): string {
  const daVariavel = process.env[CHAVE]?.trim();
  if (!daVariavel) return HOST_PADRAO_DA_GRAPH_DE_ANUNCIO;
  return hostAceito(daVariavel) ?? recusa(daVariavel);
}

/** O que a variável aponta, ou `null` quando não é base aceitável. */
export function hostAceito(valor: string | undefined): string | null {
  const trimmed = valor?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  // Em produção o `http` só passa para destino que não sai da máquina.
  if (url.protocol === "http:" && !httpAceito(url.hostname)) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * O `http` deste host pode passar? Só em produção a pergunta é restritiva, e a
 * resposta é "sim" apenas para destino que não sai da máquina.
 */
function httpAceito(hostname: string): boolean {
  return process.env.NODE_ENV !== "production" || hostInterno(hostname);
}

/** Faixas IPv4 que não saem da máquina: as três privadas e o loopback. */
const FAIXAS_INTERNAS: ReadonlyArray<readonly [number, number]> = [
  [0x0a000000, 0xff000000],
  [0x7f000000, 0xff000000],
  [0xac100000, 0xfff00000],
  [0xc0a80000, 0xffff0000],
];

/** O IPv4 está numa das faixas internas, comparado por máscara. */
function ipv4Interno(ip: string): boolean {
  const alvo = ip.split(".").reduce((total, octeto) => (total << 8) + Number(octeto), 0) >>> 0;
  return FAIXAS_INTERNAS.some(([faixa, mascara]) => ((alvo & mascara) >>> 0) === faixa);
}

/**
 * O IPv6 é interno? São três formas: loopback e o endereço não especificado, o
 * link-local (`fe80::/10`) e o ULA (`fc00::/7`). A quarta é o IPv4 embutido
 * (`::ffff:`), que o `new URL` normaliza para hexadecimal — `::ffff:127.0.0.1`
 * chega como `::ffff:7f00:1`, e é o mesmo endereço.
 */
function ipv6Interno(ip: string): boolean {
  const normalizado = ip.toLowerCase();
  if (normalizado === "::" || normalizado === "::1") return true;
  if (/^fe[89ab]/.test(normalizado)) return true;
  if (/^f[cd]/.test(normalizado)) return true;
  const embutido = /^::ffff:(.+)$/.exec(normalizado)?.[1];
  if (!embutido) return false;
  if (isIPv4(embutido)) return ipv4Interno(embutido);
  const grupos = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(embutido);
  if (!grupos) return false;
  const alto = parseInt(grupos[1]!, 16);
  const baixo = parseInt(grupos[2]!, 16);
  return ipv4Interno(`${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`);
}

/**
 * O host aponta para dentro da máquina?
 *
 * O `URL` já normalizou o literal antes de chegar aqui (`127.1` e `0x7f.0.0.1`
 * viram `127.0.0.1`), mas ele mantém os colchetes do IPv6 — e o `isIPv6` do Node
 * não os aceita, então eles saem antes da pergunta.
 *
 * Nome sem ponto nenhum é interno por construção: é assim que `app` e `waha` se
 * enxergam na rede do Docker. Um domínio público sempre tem pelo menos um ponto,
 * e é por isso que a checagem é "tem ponto?", não uma lista de nomes.
 */
function hostInterno(hostname: string): boolean {
  const semRaiz = hostname.replace(/\.$/, "").toLowerCase();
  const literal = semRaiz.startsWith("[") && semRaiz.endsWith("]") ? semRaiz.slice(1, -1) : semRaiz;
  if (isIPv4(literal)) return ipv4Interno(literal);
  if (isIPv6(literal)) return ipv6Interno(literal);
  if (semRaiz === "localhost" || semRaiz.endsWith(".localhost")) return true;
  return !semRaiz.includes(".");
}

function recusa(valor: string): string {
  console.warn(
    `[ads.meta] ${CHAVE} recusado (${JSON.stringify(valor)}): use uma base absoluta ` +
      `http:// ou https://. Falando com o host real desta vez.`,
  );
  return HOST_PADRAO_DA_GRAPH_DE_ANUNCIO;
}
