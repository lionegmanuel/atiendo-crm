/**
 * O PISO DA INSTALAÇÃO PARA "EXIGIR ASSINATURA NO WEBHOOK" — dentro da cerca.
 *
 * A tela de `/admin/sistema` grava essa escolha no banco, e o `.env` é o piso
 * de quem nunca abriu a tela. A variável que carrega esse piso tem o nome do
 * transporte legado, e é por isso que ela mora AQUI: `lib/channels/` é a
 * fronteira que pode nomear provider (doutrina de restrição de canal,
 * invariante 1), e `lib/instalacao/` é feature — ela pergunta pelo
 * comportamento, não pelo transporte.
 *
 * Sem esta função, `lib/instalacao/comportamento-servidor.ts` lia a variável
 * direto e o `pnpm lint:channels` reprovava o PR inteiro. Pôr o arquivo na
 * lista de dívida teria feito a cerca aceitar mais um vazamento em vez de
 * menos um.
 */
import { env } from "@/lib/env";

/** O `.env` desta instalação exige assinatura em todo webhook de entrada? */
export function pisoDeExigenciaDeAssinaturaNoWebhook(): boolean {
  return env.WAHA_WEBHOOK_REQUIRE_SIGNATURE === "true";
}
