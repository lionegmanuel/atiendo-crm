/**
 * O template de produção não pode ter comentário na MESMA linha do valor.
 *
 * ─── O defeito que este teste tranca ────────────────────────────────────────
 *
 * `load_env` (`hostgator-setup-kit/_common.sh`) lê assim:
 *
 *     key="${line%%=*}"; val="${line#*=}"
 *
 * Tudo depois do primeiro `=` vira valor — **inclusive o comentário**. O
 * `docker compose` limpa comentário inline no `env_file:`; os scripts shell do
 * kit não. Os dois leem o MESMO arquivo e discordam.
 *
 * E o caminho documentado leva direto ao defeito: o README do kit manda copiar
 * este template para rodar `install.sh --yes`. Quem segue a receita recebe, por
 * exemplo:
 *
 *     OWNER_PASSWORD = "                          # senha forte do primeiro admin"
 *
 * O admin é criado com essa string como senha, e a pessoa não entra com a senha
 * que acha que definiu. Medido numa instalação real: 28 chaves afetadas.
 *
 * ─── Por que um teste, e não só a correção ──────────────────────────────────
 *
 * A correção move os comentários para a linha de cima — mas nada impede que a
 * próxima chave nasça com o comentário ao lado de novo, e o defeito só aparece
 * na instalação de alguém. Este arquivo é a catraca.
 *
 * ─── Por que a checagem é sobre a FORMA, e não sobre o parser ───────────────
 *
 * Trocar `load_env` para descartar `#` em diante seria mais abrangente e mais
 * arriscado: valor legítimo que contenha " #" (uma senha, por exemplo) passaria
 * a ser truncado em silêncio em toda instalação existente. A forma do template é
 * o que o caminho documentado usa, e é onde o conserto não tem efeito colateral.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATE = ".env.hostgator.example";

/** Uma linha `CHAVE=valor`, ignorando comentário solto e linha vazia. */
const ATRIBUICAO = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Valor entre aspas é lido inteiro pelo parser — `#` ali dentro é conteúdo. */
function citado(valor: string): boolean {
  const v = valor.trim();
  return v.length > 1 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'");
}

describe("template de produção × parser do kit", () => {
  it("nenhuma chave tem comentário na mesma linha do valor", () => {
    const texto = readFileSync(join(process.cwd(), TEMPLATE), "utf8");

    const ofensoras = texto
      .split("\n")
      .map((linha, i) => ({ linha, numero: i + 1 }))
      .filter(({ linha }) => {
        const m = ATRIBUICAO.exec(linha);
        if (!m) return false;
        const valor = m[2] ?? "";
        if (citado(valor)) return false;
        // `\s+#` e não `#`: `APP_ACCENT_HEX=#7a5cd6` é valor legítimo, e o
        // parser o entrega inteiro. O que corrompe é o comentário SEPARADO por
        // espaço, que é o que o autor quis que fosse comentário.
        return /\s+#/.test(valor);
      })
      .map(({ linha, numero }) => `${TEMPLATE}:${numero}  ${linha.trim()}`);

    expect(
      ofensoras,
      `Comentário na mesma linha do valor. O parser do kit entrega o comentário DENTRO ` +
        `do valor (\`val="\${line#*=}"\` em hostgator-setup-kit/_common.sh), e quem segue a ` +
        `receita do README (copiar este arquivo + install.sh --yes) instala com o valor ` +
        `corrompido. Mova o comentário para a linha de cima:\n${ofensoras.join("\n")}`,
    ).toEqual([]);
  });
});
