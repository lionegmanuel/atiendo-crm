/**
 * O bloco de CSS da marca da ORGANIZAÇÃO — e o motivo de ele NÃO ir para o
 * `<head>`.
 *
 * ── Por que aqui dentro, e não no layout raiz ────────────────────────────────
 *
 * O `<head>` pertence ao layout raiz, que é o mesmo de `/login`, da tela de erro
 * e do onboarding. Um bloco emitido lá sobreviveria ao logout: sair é Server
 * Action + `redirect("/login")` disparado por `startTransition`
 * (`components/shell/UserMenu.tsx`), ou seja, navegação client-side — nada no
 * caminho força full reload, e o `<head>` não desmonta. A cor do cliente final
 * continuaria pintando a tela de entrada de todo mundo.
 *
 * Renderizado DENTRO da subárvore de `/app`, o React o remove quando o layout
 * desmonta. O tempo de vida do bloco passa a ser o tempo de vida da sessão
 * dentro do tenant, sem ninguém precisar lembrar de apagá-lo.
 *
 * ── Por que SEM `href` e SEM `precedence` ────────────────────────────────────
 *
 * São exatamente as duas props que fazem o React 19 IÇAR um `<style>` para o
 * `<head>` e passar a gerenciá-lo como recurso deduplicado. Com elas, o
 * parágrafo acima deixaria de valer — o bloco iria para o topo do documento e
 * sobreviveria à desmontagem desta árvore. `grep -rn precedence app/ components/
 * lib/` devolve 1 linha, e é comentário sobre rotas: nada neste projeto depende
 * desse comportamento, e aqui ele seria o defeito.
 *
 * ── Por que `id`, e não uma classe ou nada ───────────────────────────────────
 *
 * É o que torna o bloco identificável na tela: sem ele, achá-lo só dá varrendo
 * todos os `<style>` do documento atrás de um `--color-` no texto — e
 * distinguir o bloco da organização do bloco da instalação (`marca-instalacao`,
 * emitido no `<head>` pelo layout raiz) seria impossível. Vale para o suporte,
 * para o diagnóstico e para a spec de e2e, que afirma a AUSÊNCIA dele em
 * `/login` como uma das três provas de que a cor não vaza.
 */
export function EstiloDaMarcaDaOrganizacao({ css }: { css: string | null }) {
  // `null` é o caso comum, não falha: organização que não configurou marca não
  // tem o que injetar, e a cor da instalação (emitida na raiz) continua valendo.
  // Emitir o bloco mesmo assim, com os valores da instalação, seriam bytes sem
  // efeito nenhum — e faria a presença do elemento parar de responder à única
  // pergunta que ele responde: "esta organização tem cor própria?".
  if (!css) return null;
  // Texto já passado pela allowlist de forma de `lib/branding/css.ts`, que recusa
  // `<` e devolve `null` em vez de string parcial. Mesmo contrato do bloco da
  // instalação em `app/layout.tsx`.
  return <style id="marca-organizacao" dangerouslySetInnerHTML={{ __html: css }} />;
}
