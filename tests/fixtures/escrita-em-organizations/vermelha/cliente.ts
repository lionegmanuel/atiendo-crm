/**
 * Fixture VERMELHA da cerca de `organizations` — os MESMOS nomes, o tipo de
 * SESSÃO.
 *
 * A cerca passou a atravessar o `import` até o módulo que declara o tipo (issue
 * #1157, item 1). O que autoriza continua sendo o TIPO resolvido, nunca o nome
 * do que foi importado: este arquivo exporta `Admin` e `Pedido` iguais aos do
 * `../verde/cliente.ts`, e o que eles resolvem é `createClient()` — o cliente
 * de sessão, aquele que a RLS não deixa escrever.
 *
 * Se algum dia o reconhecimento aceitar o import pelo NOME, o caso vermelho do
 * CONTROLE fica verde e acusa: escrever em `organizations` por baixo da cerca
 * voltaria a custar renomear um tipo.
 */
import type { createClient } from "@/lib/supabase/server";

export type Admin = Awaited<ReturnType<typeof createClient>>;

export interface ComAdmin {
  admin: Awaited<ReturnType<typeof createClient>>;
}

export interface Pedido extends ComAdmin {
  orgId: string;
}
