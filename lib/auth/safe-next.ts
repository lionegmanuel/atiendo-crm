/**
 * Destino interno seguro para o parâmetro `next` do login/MFA.
 *
 * Veio de um relatório de segurança da comunidade: `next` chegava cru ao
 * `redirect()` de `signInWithPassword` e `verifyMfa`, e as duas telas são
 * públicas (`lib/auth/public-paths.ts`). Um link forjado
 * (`/login?next=https://evil.example`) leva a vítima a digitar a senha no site
 * de verdade e, no sucesso, o servidor a despacha para o site do atacante —
 * CWE-601, e o pior é que a vítima chega lá logo depois de um login legítimo,
 * que é exatamente o estado em que ela confia na tela seguinte.
 *
 * A regra é allowlist, não denylist: só passa caminho relativo à raiz. Tudo o
 * mais vira o destino padrão. Uma denylist ("bloqueie http://") erra nas formas
 * que não parecem URL — `//evil.example` é protocol-relative e o browser trata
 * como host externo; `/\evil.example` é normalizado para `//` por alguns
 * agentes; `javascript:` não redireciona no Next atual, mas depender disso é
 * apostar num detalhe do framework.
 */
export function safeNext(next: string | undefined | null, fallback: string): string {
  if (!next) return fallback;

  // Só caminho absoluto-na-raiz. Isto já elimina "https://evil", "//evil",
  // "javascript:...", "data:..." e qualquer coisa com esquema.
  if (!next.startsWith("/")) return fallback;

  // "//host" e "/\host" são protocol-relative: o browser sai do site.
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;

  // Barra invertida vira barra em vários agentes — normaliza antes de decidir.
  if (next.includes("\\")) return fallback;

  // Controle (0x00–0x1F, 0x7F) e espaço permitem contrabandear cabeçalho ou
  // enganar o parser. O range vai por código de propósito: `[ -]`, a forma que
  // parece certa, significa "espaço OU hífen" e rejeitaria /app/meus-leads.
  if (/[\u0000-\u0020\u007f]/.test(next)) return fallback;

  return next;
}
