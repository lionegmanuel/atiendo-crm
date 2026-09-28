/**
 * DE ONDE VEIO A REQUISIÇÃO — uma régua só.
 *
 * O repo lia isto inline em 15 lugares (`x-forwarded-for?.split(",")[0]`), e só
 * um deles — o rate limit de autenticação — tinha o plano B do `x-real-ip`, que
 * é o que o Nginx costuma setar sozinho. Quinze cópias de uma leitura é quinze
 * lugares para consertar quando a hospedagem muda de header.
 *
 * ═══ O QUE ESTE VALOR NÃO É ═══
 *
 * Não é prova de origem. Os dois headers são escritos por quem está na frente e
 * podem ser forjados por quem faz a requisição quando não há proxy conferindo.
 * Nada no produto pode DECIDIR com base neste valor — nem autorizar, nem
 * bloquear. Ele serve para (a) isolar um balde de rate limit, onde forjar só
 * troca o atacante de balde, e (b) mostrar a quem opera de onde as coisas
 * chegaram, para reconhecer padrão.
 *
 * ═══ `null` em vez de sentinela ═══
 *
 * "Não sei de onde veio" precisa ser inexprimível como se fosse uma origem.
 * Uma string tipo `"desconhecido"` vira balde compartilhado no rate limit e
 * vira uma linha que parece um IP na tela.
 */

import { isIP } from "node:net";

/** O primeiro salto do `x-forwarded-for`, ou o `x-real-ip`. `null` = sem proxy à frente. */
export function ipDoCliente(headers: Headers): string | null {
  const encaminhado = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * O mesmo valor, mas só quando o Postgres o aceitaria como `inet`.
 *
 * A coluna `webhook_lead_captures.remote_ip` é `inet`, e um INSERT com texto que
 * não é IP falha com `22P02` — o que derrubaria o registro inteiro da captação
 * por causa de um header malformado (que é justamente o que um cliente hostil
 * mandaria). Aqui o valor inválido vira `null`: a linha entra, sem a origem.
 *
 * ═══ Por que `net.isIP` e não uma regex ═══
 *
 * A primeira versão desta função tinha uma regex escrita à mão para IPv6
 * (`/^[0-9a-fA-F:]+…/` mais `includes(":")`), e ela ACEITAVA lixo que o Postgres
 * recusa: `":::::"` passa (só hex e dois-pontos), `"12345::"` passa (cinco
 * dígitos hex num grupo de quatro). Qualquer um dos dois num `X-Forwarded-For`
 * derrubava o INSERT inteiro com `22P02` — e como `registrarCaptacao` não lança,
 * a captação sumia da tela em silêncio. Ou seja: um header hostil apagava do
 * histórico exatamente a batida que alguém queria investigar.
 *
 * `net.isIP` é a implementação do próprio Node (devolve 4, 6 ou 0) e não tem
 * como divergir por descuido de regex. IPv6 é notoriamente difícil de validar à
 * mão — `::ffff:1.2.3.4`, zeros comprimidos, grupos de tamanho variável — e
 * escrever essa regex era trabalho para uma ferramenta que já existe.
 *
 * ⚠️ `isIP` sozinho NÃO BASTA, e isto foi MEDIDO contra o Postgres, não
 * presumido — a primeira versão deste comentário afirmava o contrário:
 *
 *     node  -> isIP("fe80::1%eth0") === 6           (aceita a zona)
 *     psql  -> ERROR: invalid input syntax for type inet: "fe80::1%eth0"
 *
 * Ou seja, o identificador de zona (`%eth0`) atravessaria o guarda e recriaria
 * exatamente o `22P02` que ele existe para impedir. O `%` é recusado antes.
 * Notação CIDR (`/64`) também sai: o Postgres a aceitaria, mas um prefixo de
 * rede não é "de onde veio esta requisição".
 *
 * A validação é de FORMA, não de veracidade — ver o cabeçalho.
 */
export function ipDoClienteParaInet(headers: Headers): string | null {
  const bruto = ipDoCliente(headers);
  if (bruto === null) return null;
  if (bruto.includes("%") || bruto.includes("/")) return null;
  return isIP(bruto) === 0 ? null : bruto;
}
