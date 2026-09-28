/**
 * O telefone do contato no formato que o Google casa: E.164 (`+` e só dígitos,
 * com o código do país) e SHA-256 em hexadecimal minúsculo.
 *
 * O número vem de `contacts.phone_number`, que para o WhatsApp é o JID sem o
 * sufixo — já internacional. Número curto demais para ser E.164 (menos de 8
 * dígitos) ou longo demais (mais de 15) não vira identificador: mandar lixo
 * criptografado só piora a taxa de correspondência que se quer melhorar.
 */
import { createHash } from "node:crypto";

export function telefoneE164(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `+${digitos}`;
}

export function telefoneCriptografado(telefone: string | null | undefined): string | null {
  const e164 = telefoneE164(telefone);
  return e164 ? createHash("sha256").update(e164).digest("hex") : null;
}
