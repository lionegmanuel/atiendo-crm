/**
 * Quem vence entre o BANCO e o `.env`, e quando o `.env` promove.
 *
 * Puro de propósito: não fala com banco, não lê `process.env` e não decifra
 * nada. Recebe o estado já resolvido das duas camadas e decide — o que permite
 * exercitar a regra inteira sem Postgres, e mantém o módulo que fala com o
 * banco livre de regra de negócio. Mesma separação de `lib/branding/resolve.ts`
 * e `lib/branding/instalacao.ts`.
 *
 * A doutrina é a da marca (0155), generalizada: **o banco está ACIMA do `.env`,
 * e o `.env` é semente e piso de rollback.** O `agent.sh` do kit, em falha de
 * atualização, reverte a IMAGEM e o `.env` — nunca o schema. Ou seja, o rollback
 * põe código antigo sobre banco novo por construção. Com o `.env` intacto, a
 * instalação degrada para o valor de instalação em vez de ficar sem credencial
 * nenhuma no pior momento possível.
 */

/**
 * O que o banco tem a dizer sobre uma chave, já em claro.
 *
 * `null` (o tipo inteiro) = não há linha: o `.env` responde. Já uma linha COM
 * `valor: null` é outra coisa — é alguém que esvaziou o campo pela tela, e essa
 * é uma escolha tão válida quanto preencher.
 */
export type EstadoDaLinha = {
  readonly valor: string | null;
  /**
   * `true` = o valor entrou por semeadura automática do `.env` e pode ser
   * re-semeado. `false` = uma pessoa escreveu pela tela, e o `.env` nunca mais
   * sobrescreve.
   */
  readonly semeadoDoEnv: boolean;
} | null;

export type Fonte = "banco" | "ambiente" | "ausente";

export interface ValorResolvido {
  readonly valor: string | null;
  readonly fonte: Fonte;
}

/**
 * Texto que vale como valor. Espaço em branco não conta: o `.env` de uma VPS
 * real tem `CHAVE=` sobrando de pergunta pulada na entrevista do instalador, e
 * tratar isso como "configurado" faria a tela mostrar credencial onde não há.
 */
function texto(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

export function resolver(linha: EstadoDaLinha, doAmbiente: string | null): ValorResolvido {
  if (linha) return { valor: texto(linha.valor), fonte: "banco" };
  const doEnv = texto(doAmbiente);
  return doEnv === null ? { valor: null, fonte: "ausente" } : { valor: doEnv, fonte: "ambiente" };
}

export type Semeadura = "inserir" | "atualizar" | "nao";

/**
 * `semeadoDoEnv` NÃO é enfeite de proveniência — é o que impede a semeadura de
 * desfazer uma escolha humana.
 *
 * O caso que mata o campo, e que a marca já pagou: a pessoa apaga o valor de
 * propósito para voltar ao padrão do produto; no render seguinte a semeadura
 * reescreve o valor antigo do `.env`, e o campo parece não funcionar. Por isso
 * uma linha com `semeadoDoEnv: false` nunca é semeada de novo, inclusive quando
 * está vazia.
 *
 * `atualizar` existe para o caso real do kit: o operador que instalou sem a
 * chave e preencheu o `.env` depois, ou que trocou a chave lá. Enquanto ninguém
 * tocou no campo pela tela, o `.env` continua mandando.
 */
export function precisaSemear(linha: EstadoDaLinha, doAmbiente: string | null): Semeadura {
  const doEnv = texto(doAmbiente);
  if (doEnv === null) return "nao";
  if (!linha) return "inserir";
  if (!linha.semeadoDoEnv) return "nao";
  return texto(linha.valor) === doEnv ? "nao" : "atualizar";
}
