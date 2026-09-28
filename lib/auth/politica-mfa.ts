/**
 * QUEM É OBRIGADO A CADASTRAR A VERIFICAÇÃO EM DUAS ETAPAS.
 *
 * ═══ O QUE MUDOU, E POR QUÊ ═══
 *
 * A regra era uma linha sem opção: `isPlatformAdmin || role === "admin"`. Na
 * prática isso significava que TODA instalação self-host forçava o dono a
 * configurar TOTP antes de usar o produto — e o `install.sh` cria o dono como
 * platform admin, então nem trocar de papel escapava.
 *
 * O efeito, medido percorrendo o wizard: a pessoa termina seis passos, clica em
 * "Começar a usar", e a PRIMEIRA coisa que vê é um bloqueador de tela inteira
 * pedindo um aplicativo autenticador. Um sétimo passo que a barra de progresso
 * nunca anunciou, na hora em que ela finalmente ia ver o produto funcionando.
 *
 * Decisão do dono do produto: o cadastro passa a ser OPCIONAL e ligado numa tela
 * de Configurações. Segurança que expulsa o usuário na primeira tela não protege
 * ninguém — ela só faz o produto não ser usado.
 *
 * ═══ AS DUAS PERGUNTAS, QUE NÃO SÃO A MESMA ═══
 *
 * 1. **Preciso CADASTRAR?** É política, e é o que este arquivo responde. Depende
 *    de quem decidiu exigir: a plataforma (`platform_admins.mfa_required`) ou a
 *    empresa (`organizations.settings.security.mfa_required`).
 *
 * 2. **Preciso PROVAR agora?** É sessão, e a resposta é sempre a mesma: quem TEM
 *    fator cadastrado precisa provar. Isso NÃO depende da política — ver
 *    `mfaEmDivida` em `lib/auth/server.ts`. Antes ele começava perguntando a
 *    política, e com o cadastro opcional isso teria virado um buraco: quem
 *    ativasse a verificação por vontade própria teria o fator ignorado na
 *    sessão, que é o mesmo que não ter.
 *
 * ⚠️ `platform_admins.mfa_required` JÁ EXISTIA E NUNCA FOI LIDO. A coluna está no
 * schema, aparece na tela de admin da plataforma com um badge de sim/não, e o
 * gate ignorava: ele olhava só o booleano `is_platform_admin`. Era um controle
 * decorativo — o operador podia desmarcá-lo e nada mudava. Agora ele decide de
 * verdade.
 */

import type { Role } from "@/lib/auth/types";

export interface PoliticaDeMfa {
  /** O papel na organização ativa. `undefined` = sem organização resolvida. */
  role: Role | undefined;
  isPlatformAdmin: boolean;
  /**
   * `platform_admins.mfa_required` da linha desta pessoa. `null` quando ela não
   * é platform admin (ou quando a leitura não trouxe a linha).
   */
  plataformaExige: boolean | null;
  /**
   * `organizations.settings.security.mfa_required` da organização ativa.
   * Ausente = a empresa não escolheu, e o padrão é NÃO exigir.
   */
  empresaExige: boolean;
}

/**
 * Precisa cadastrar a verificação em duas etapas?
 *
 * ⚠️ AS DUAS ORIGENS SOMAM, NUNCA SE ANULAM. Um platform admin cuja plataforma
 * exige continua obrigado mesmo numa empresa que não exige — a superfície dele
 * alcança todos os tenants, e não é a preferência de um deles que a libera. E um
 * admin de tenant é obrigado se a empresa dele decidiu exigir, mesmo que a
 * plataforma não exija.
 */
export function exigeCadastroDeMfa(p: PoliticaDeMfa): boolean {
  if (p.isPlatformAdmin && p.plataformaExige === true) return true;
  if (p.role === "admin" && p.empresaExige) return true;
  return false;
}

/**
 * A leitura de `organizations.settings` — defensiva, como a do runtime.
 *
 * ⚠️ AUSENTE É `false`, E ISSO É A DECISÃO, não um descuido. `settings` é jsonb
 * livre: toda organização que existe hoje chega aqui sem a chave, e ela precisa
 * significar "não exige" para que a mudança tenha o efeito pedido. Um default
 * `true` faria o campo novo não mudar nada.
 */
export function empresaExigeMfa(settings: unknown): boolean {
  const s = (settings as { security?: unknown } | null)?.security;
  return (s as { mfa_required?: unknown } | null | undefined)?.mfa_required === true;
}
