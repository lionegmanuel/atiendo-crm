/**
 * Fixture VERDE da cerca de `organizations` — o TIPO do cliente admin mora em
 * outro arquivo.
 *
 * A cerca resolve a anotação de um parâmetro. Enquanto ela só olhava o arquivo
 * que escreve, o parâmetro tipado por um alias IMPORTADO
 * (`import type { Admin } from "@/…"`) ou por uma `interface` que herda o
 * cliente por `extends` levava falso vermelho: a escrita estava certa e a cerca
 * acusava (issue #1157, itens 1 e 2).
 *
 * Aqui os dois chegam de outra casa — `Admin` é alias de
 * `ReturnType<typeof createAdminClient>` e `Pedido` herda `admin` de `ComAdmin`.
 * O CONTROLE usa os nomes DESTE arquivo e os do `../vermelha/cliente.ts`, que
 * declara os mesmos nomes com o tipo de SESSÃO: mesma escrita, tipos opostos.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

export type Admin = ReturnType<typeof createAdminClient>;

export interface ComAdmin {
  admin: ReturnType<typeof createAdminClient>;
}

export interface Pedido extends ComAdmin {
  orgId: string;
}
