/**
 * O TRANSPORTE DE WHATSAPP DESTA INSTALAÇÃO ESTÁ DE PÉ?
 *
 * Pergunta de INSTALAÇÃO, não de canal: não há sessão para consultar nem adapter
 * para pedir — o que se quer saber é se quem instalou o sistema chegou a apontar
 * o serviço de WhatsApp no `.env`. É o que o passo 1 do onboarding mostra em "já
 * está de pé", antes de existir qualquer `channel_sessions`.
 *
 * ⚠️ POR QUE ELA MORA AQUI, e não em `lib/instalacao/`. A doutrina de restrição
 * de canal (`scripts/lint-channels.ts`) proíbe nomear provider fora de
 * `lib/channels/` — e estava certa: `lib/instalacao/ambiente.ts` lia
 * `WAHA_API_BASE_URL` direto e tinha um campo chamado `waha`, então uma
 * instalação com OUTRO transporte seria descrita pela tela como "o WhatsApp
 * desta instalação ainda não subiu" mesmo com o dela de pé. O nome do provedor
 * fica de um lado só desta fronteira; quem pergunta recebe a CAPACIDADE.
 *
 * (Medido: o linter só acusou quando rodei `pnpm lint:channels` — `pnpm lint`
 * não o inclui, e por isso esses arquivos vazaram desde que nasceram.)
 */

/** Ambiente injetável — mesma forma que `lib/instalacao/ambiente.ts` usa. */
export type FonteDeAmbiente = Record<string, string | undefined>;

export interface TransporteDeWhatsapp {
  /** O endereço do serviço está configurado? */
  apontado: boolean;
  /** E a chave dele — de verdade, não o placeholder que o kit deixa? */
  comChave: boolean;
}

/** O valor que o `.env.example` traz e que NÃO conta como chave configurada. */
const PLACEHOLDER_DA_CHAVE = "dev_plaintext_change_me";

function preenchida(src: FonteDeAmbiente, nome: string): boolean {
  return (src[nome] ?? "").trim() !== "";
}

export function lerTransporteDeWhatsapp(src: FonteDeAmbiente): TransporteDeWhatsapp {
  return {
    apontado: preenchida(src, "WAHA_API_BASE_URL"),
    comChave:
      preenchida(src, "WAHA_API_KEY") && src.WAHA_API_KEY?.trim() !== PLACEHOLDER_DA_CHAVE,
  };
}
