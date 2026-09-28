import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RUN_STALE_AFTER_MS } from "@/lib/system/update-run";

import { SQL_ERRORS } from "./erros-do-banco";

const RAIZ = path.resolve(__dirname, "../..");
const pasta = path.join(RAIZ, "supabase/migrations");
/**
 * Varre TODA migration que levante código `extension_*`, não só a 0271.
 *
 * A versão anterior casava `_0271_extensoes_declarativas.sql` e mais nada. Quando a 0280
 * acrescentou `extension_permissions_changed`, o código nasceu FORA desta vigilância: sem
 * frase e sem status, o serviço responderia 503 "não foi possível confirmar o resultado" —
 * e o defeito seria mudo, porque este teste continuaria verde.
 *
 * O filtro é por CONTEÚDO (a migration levanta algum `extension_*`?) e não por nome de
 * arquivo, para alcançar também uma migration futura que não se chame "extensoes".
 */
const LEVANTA = /message\s*=\s*'(extension_[a-z_]+)'/g;
const migrations = readdirSync(pasta)
  .filter((nome) => nome.endsWith(".sql"))
  .map((nome) => readFileSync(path.join(pasta, nome), "utf8"))
  .filter((conteudo) => new RegExp(LEVANTA.source).test(conteudo));
if (migrations.length === 0) throw new Error("Nenhuma migration de extensões encontrada");
const migration = migrations.join("\n");

describe("códigos das funções de extensão", () => {
  it("todo código que o banco levanta tem frase e status no serviço", () => {
    const levantados = [...migration.matchAll(/message\s*=\s*'(extension_[a-z_]+)'/g)].map(
      (achado) => achado[1] as string,
    );
    // Controle da sonda: um regex quebrado devolveria zero e deixaria o teste verde.
    expect(levantados.length).toBeGreaterThan(40);
    const faltando = [...new Set(levantados)].filter((codigo) => !(codigo in SQL_ERRORS));
    expect(faltando).toEqual([]);
  });

  it("a tabela não guarda código que nenhuma função levanta mais", () => {
    const levantados = new Set(
      [...migration.matchAll(/message\s*=\s*'(extension_[a-z_]+)'/g)].map((achado) => achado[1]),
    );
    const orfaos = Object.keys(SQL_ERRORS).filter((codigo) => !levantados.has(codigo));
    expect(orfaos).toEqual([]);
  });

  it("a régua de atualização do sistema em curso no banco é a mesma do app", () => {
    const funcao = migration.match(
      /function public\.fn_extensions_core_update_in_progress\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    const minutos = funcao?.[1]?.match(/interval '(\d+) minutes'/)?.[1];
    expect(minutos).toBeDefined();
    expect(Number(minutos) * 60 * 1000).toBe(RUN_STALE_AFTER_MS);
  });
});
