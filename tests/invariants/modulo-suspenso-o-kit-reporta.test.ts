/**
 * MÓDULO SUSPENSO — o kit REPORTA (ADR-0002, D6; migration 0340).
 *
 * `modulo-instalado.test.ts` prova as funções. Este arquivo prova a PROMESSA ao operador, pelo
 * caminho do kit: o `update.sh` aplica o `baseline.sql` com `psql -q -f`, SEM `ON_ERROR_STOP`, e
 * `reaplicar_baseline` (hostgator-setup-kit/_common.sh) só acusa linha `ERROR|FATAL` que não case
 * com `BASELINE_ERROS_BENIGNOS`. Aqui:
 *
 *   - as duas linhas aplicadas são as do RODAPÉ do `baseline.sql`, lidas do arquivo — não uma
 *     cópia que poderia divergir dele;
 *   - o `psql` roda como o kit o roda (`-q -f`, sem `ON_ERROR_STOP`), com a saída de erro junto;
 *   - o filtro é o do kit, com a expressão lida do `_common.sh`.
 *
 * O que se mede: com um módulo quebrado, o filtro do kit devolve uma linha que nomeia o módulo, e a
 * marca de suspenso SOBREVIVE ao erro (dois comandos, cada um confirmado sozinho). Com o módulo
 * são, o filtro devolve vazio — sem isto, um rodapé que sempre errasse passaria aqui também.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const container = process.env.TEST_DB_CONTAINER as string;
const MODULO = "sondakit";

const kit = readFileSync(path.join(process.cwd(), "hostgator-setup-kit/_common.sh"), "utf8");
const benignos = kit.match(/^BASELINE_ERROS_BENIGNOS='([^']+)'/m)?.[1];
if (!benignos) throw new Error("BASELINE_ERROS_BENIGNOS não encontrado em hostgator-setup-kit/_common.sh");
const BENIGNOS = new RegExp(benignos, "i");

/** As chamadas do rodapé do baseline, na ordem em que o arquivo as faz. */
const RODAPE = (() => {
  const baseline = readFileSync(path.join(process.cwd(), "supabase/baseline.sql"), "utf8");
  const linhas = baseline
    .split("\n")
    .filter((l) => /^do \$f\$ begin perform public\.fn_(reaplicar|conferir)_modulos_instalados\(\); end \$f\$;$/.test(l));
  return linhas;
})();

/** `psql -q -f` sem ON_ERROR_STOP, como `reaplicar_baseline`; devolve o que o filtro do kit acusa. */
function aplicarComoOKit(script: string): { inesperado: string[]; codigo: number | null } {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-q", "-f", "-"], {
    input: script,
    encoding: "utf8",
  });
  const saida = `${r.stdout}\n${r.stderr}`;
  const inesperado = saida
    .split("\n")
    .filter((l) => /ERROR|FATAL/i.test(l))
    .filter((l) => !BENIGNOS.test(l));
  return { inesperado, codigo: r.status };
}

function provisionadora(corpo: string): void {
  sql(`
    create or replace function public.fn_${MODULO}_provisionar()
    returns void language plpgsql security definer set search_path = public as $prov$
    begin ${corpo} end $prov$;
    revoke execute on function public.fn_${MODULO}_provisionar() from public, anon, authenticated;
    grant execute on function public.fn_${MODULO}_provisionar() to service_role;`);
}

beforeAll(() => {
  provisionadora("perform 1;");
  sql(`insert into public.modulos_instalados (modulo) values ('${MODULO}') on conflict (modulo) do nothing;`);
});

afterAll(() => {
  sql(`delete from public.modulos_instalados where modulo = '${MODULO}';
       drop function if exists public.fn_${MODULO}_provisionar();`);
});

describe("o rodapé do baseline, aplicado como o kit aplica", () => {
  it("o rodapé tem as duas chamadas, reaplicar ANTES de conferir", () => {
    expect(RODAPE).toEqual([
      "do $f$ begin perform public.fn_reaplicar_modulos_instalados(); end $f$;",
      "do $f$ begin perform public.fn_conferir_modulos_instalados(); end $f$;",
    ]);
  });

  it("módulo são: o filtro do kit não acusa nada", () => {
    const r = aplicarComoOKit(RODAPE.join("\n"));
    expect(r.inesperado).toEqual([]);
    expect(r.codigo).toBe(0);
  });

  it("módulo quebrado com o texto que o kit engole: o kit acusa, nomeando o módulo, e a suspensão persiste", () => {
    provisionadora(`raise exception 'relation "sonda" already exists';`);
    const r = aplicarComoOKit(RODAPE.join("\n"));
    expect(r.inesperado).toHaveLength(1);
    expect(r.inesperado[0]).toContain(MODULO);
    // Sem ON_ERROR_STOP o psql sai 0 mesmo com erro de SQL — é por isso que o kit lê a SAÍDA.
    expect(r.codigo).toBe(0);
    expect(sql(`select estado from public.modulos_instalados where modulo = '${MODULO}';`)).toBe("suspenso");
  });
});
