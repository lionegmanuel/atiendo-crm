/**
 * Catraca: identificadores de produção não voltam ao código.
 *
 * Fixtures e comentários de medição já carregaram identificadores de uma
 * operação real (um par LID/telefone do WhatsApp e o IPv4 de uma VPS). Eles
 * foram trocados por valores sintéticos — telefone `5511900000001`, LID
 * `100000000000001@lid`, IP `203.0.113.10` (faixa de documentação, RFC 5737).
 *
 * Este arquivo guarda SÓ o SHA-256 de cada valor, nunca o valor: ele varre os
 * números e IPv4 do código e reprova quando algum bate com um hash abaixo.
 * Precisa de fixture realista? Use um sintético, não copie do banco.
 *
 * Fora da varredura: `supabase/migrations/` (migration aplicada não se edita) e
 * o histórico do git.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

const HASHES_PROIBIDOS = new Set([
  "1dc5f97845cf6439fe2a47a0c4101c4cf57b0211c63ed8e7d07e3c46867387cb",
  "5832af35c7c2f293e344819bfc4868519762c4abd5e18ed730c9a5c8420c8d22",
  "e4e889a2bdb11363be183744c1572fa0e1b33be81f3b481be02cbe3790ea04b7",
]);

const AREAS = ["app", "lib", "workers", "components", "hooks", "tests", "docs"];

// Rastreados E não rastreados (fora do .gitignore): a catraca pega o valor
// antes do commit, não só depois.
function arquivos(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...AREAS],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((f) => f && fs.existsSync(f)); // --cached lista também o apagado do disco
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Sequências de dígitos isoladas (telefone, LID) e IPv4.
const CANDIDATOS = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d])|(?<!\d)\d{8,16}(?!\d)/g;

describe("identificadores de produção não voltam ao código", () => {
  it("nenhum número ou IPv4 do código bate com um hash proibido", () => {
    const achados: string[] = [];
    for (const arquivo of arquivos()) {
      const texto = fs.readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(CANDIDATOS)) {
        if (HASHES_PROIBIDOS.has(sha256(m[0]))) {
          // Só o caminho e a linha — a mensagem de falha não pode repetir o valor.
          achados.push(`${arquivo}:${texto.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(achados, "troque por um valor sintético (ver o cabeçalho)").toEqual([]);
  });

  it("a sonda enxerga os formatos que precisa enxergar", () => {
    const achar = (t: string) => [...t.matchAll(CANDIDATOS)].map((m) => m[0]);
    expect(achar('from: "100000000000001@lid"')).toEqual(["100000000000001"]);
    expect(achar("+5511900000001@s.whatsapp.net")).toEqual(["5511900000001"]);
    expect(achar("http://203.0.113.10:18080/")).toEqual(["203.0.113.10"]);
  });
});
