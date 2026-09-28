/**
 * O VÍNCULO ENTRE O NAVEGADOR E O `state` DO CONSENTIMENTO.
 *
 * ─── Por que este arquivo existe ─────────────────────────────────────────────
 *
 * O cookie de sessão do produto é `sameSite: "strict"` (`lib/supabase/server.ts`).
 * Strict retém o cookie em QUALQUER navegação vinda de outro site — inclusive a
 * volta legítima do consentimento, quando o Google devolve o navegador de
 * `accounts.google.com` para o nosso `redirect_uri`.
 *
 * Consequência medida em produção (v1.8.0, na VPS do dono do produto):
 *
 *   GET /api/v1/agenda/google/callback  →  HTTP 401
 *   {"error":{"code":"unauthenticated","message":"Authentication required"}}
 *
 * O `proxy.ts` barrava antes de a rota existir. **A ida sempre funcionou e a
 * volta nunca funcionou**, em nenhuma instalação — e é essa assimetria que fez
 * o defeito passar: quem testa clicando vê o Google abrir e conclui que está
 * certo. Abrir o caminho no `proxy` não bastava: o handler relia a sessão com
 * `loadAuthUser()`, que lê o MESMO cookie e devolve `null` pelo mesmo motivo.
 *
 * ─── O que este vínculo prova, e o que ele NÃO prova ─────────────────────────
 *
 * PROVA: quem voltou do consentimento é **o mesmo navegador** que iniciou o
 * fluxo, há menos de dez minutos.
 *
 * NÃO PROVA: que a pessoa continua autenticada, que continua sendo membro da
 * organização, nem que é a mesma pessoa. A verificação antiga (`loadAuthUser()`
 * comparado ao `userId` do `state`) prometia isso — e nunca entregou, porque
 * nunca teve o cookie para ler. **Trocar uma verificação que reprova sempre por
 * uma que funciona não é perder segurança; é parar de fingir que se tinha.**
 *
 * O caso concreto que fica de fora está escrito para ninguém descobri-lo por
 * acidente: numa máquina compartilhada, A começa a conexão, sai, e B conclui a
 * aba pendente com a conta Google DELE — o vínculo casa, e a linha gravada fica
 * com a organização de A apontando para a agenda de B. Fechar isso exige a
 * sessão viajar, e ela não viaja. O caminho real é PKCE + reconfirmação na
 * volta, e está declarado como dívida no cabeçalho do callback.
 *
 * ─── Por que ASSINADO, e não o nonce cru ─────────────────────────────────────
 *
 * Um self-host costuma viver em `crm.cliente.com.br`, ao lado de outros apps do
 * mesmo domínio-pai. Um irmão comprometido grava cookie com
 * `Domain=.cliente.com.br` e o mesmo nome, e o servidor passa a receber dois
 * valores sob um nome só. Se o valor esperado fosse o nonce em claro — que
 * viaja na barra de endereços, no histórico e no log do Google — bastaria
 * plantá-lo. Assinado com `INTERNAL_SECRET`, plantar exige o segredo do
 * servidor, e quem o tem já não precisa deste ataque.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O nome não cita o provedor NEM o produto, e as duas restrições são de gates
 * diferentes:
 *
 * - `lint:channels` proíbe nome de provider fora de `lib/channels/`;
 * - `tests/unit/branding.test.ts` proíbe a marca fixada em código, porque o
 *   produto é revendido com outra marca — e este gate me pegou: a primeira
 *   versão chamava o cookie de `deskcomm_oauth_bind`.
 *
 * O cookie de SESSÃO tem o nome da marca e está na allowlist daquele gate, com
 * uma justificativa que aqui não vale: renomeá-lo deslogaria todo usuário no
 * `update.sh` do clone. Este cookie é novo — nenhuma instalação o tem —, então
 * a saída certa era renomear, não pedir exceção.
 */
export const NOME_DO_VINCULO = "crm_oauth_bind";

/** O mesmo teto do `state` (`VALIDADE_DO_ESTADO_MS`). Um não pode durar mais que o outro. */
export const VALIDADE_DO_VINCULO_S = 10 * 60;

/**
 * Assina o nonce do `state`. O segredo é o do servidor, nunca algo derivável do
 * que trafega.
 */
export function assinarVinculo(nonce: string, segredo: string): string {
  return createHmac("sha256", segredo).update(nonce, "utf8").digest("base64url");
}

/**
 * O cookie casa com o `state`?
 *
 * Compara em tempo constante e **não distingue os motivos da recusa** — ausente,
 * malformado e não-casando devolvem o mesmo `false`. Distinguir contaria a quem
 * ataca se o `state` que ele tem pertence a alguém que passou por aqui.
 */
export function vinculoConfere(
  valorDoCookie: string | undefined,
  nonce: string,
  segredo: string,
): boolean {
  if (!valorDoCookie || !nonce || !segredo) return false;
  const esperado = assinarVinculo(nonce, segredo);
  const a = Buffer.from(valorDoCookie, "utf8");
  const b = Buffer.from(esperado, "utf8");
  // `timingSafeEqual` lança quando os tamanhos diferem — por isso a checagem
  // vem antes, e não é um atalho de otimização.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
