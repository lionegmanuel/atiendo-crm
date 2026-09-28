import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkCompatibility, parseCatalog, parseManifest } from "@/lib/extensions/manifest";

/**
 * O CATÁLOGO É DERIVADO DOS PACOTES — E NINGUÉM VERIFICA UM DERIVADO QUE NÃO TEM GUARDA.
 *
 * `extensoes/catalogo.json` guarda, por pacote, o `sha256` e o `byte_length` dos bytes que o
 * host vai baixar. `validateArtifact` confere os dois no ato da instalação. Se alguém corrigir
 * uma frase de um pacote e esquecer de regerar o catálogo, nada quebra aqui: quebra na
 * instalação de um cliente, com `extension_digest_mismatch`, a um dia de distância de quem
 * fez a mudança.
 *
 * Este teste recalcula do zero e compara. Ele é a razão de o catálogo poder ser um arquivo
 * versionado em vez de um serviço.
 */

const RAIZ = join(__dirname, "..", "..");
const DIR = join(RAIZ, "extensoes", "pacotes");
const CATALOGO = join(RAIZ, "extensoes", "catalogo.json");

function pacotes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return pacotes(caminho);
    return e.name.endsWith(".json") ? [caminho] : [];
  });
}

const arquivos = pacotes(DIR).sort();
const catalogo = parseCatalog(new Uint8Array(readFileSync(CATALOGO)));

describe("catálogo de extensões", () => {
  it("tem pelo menos um pacote — loja vazia é defeito, não estado", () => {
    expect(arquivos.length).toBeGreaterThan(0);
    expect(catalogo.entries.length).toBe(arquivos.length);
  });

  it.each(arquivos.map((a) => [a.slice(RAIZ.length + 1), a] as const))(
    "%s é válido e compatível com ESTE host",
    (_rotulo, caminho) => {
      const manifest = parseManifest(new Uint8Array(readFileSync(caminho)));
      const compat = checkCompatibility(manifest);
      // Publicar pacote que o host recusa é publicar um botão que dá erro.
      expect(compat.reason).toBeNull();
      expect(compat.compatible).toBe(true);
    },
  );

  it("o digest e o tamanho de cada entrada batem com os bytes do pacote", () => {
    const divergentes = arquivos.filter((caminho) => {
      const bytes = readFileSync(caminho);
      const manifest = parseManifest(new Uint8Array(bytes));
      const entrada = catalogo.entries.find(
        (e) => e.publisher === manifest.publisher && e.name === manifest.name,
      );
      if (!entrada) return true;
      return (
        entrada.sha256 !== createHash("sha256").update(bytes).digest("hex") ||
        entrada.byte_length !== statSync(caminho).size ||
        entrada.version !== manifest.version
      );
    });
    expect(
      divergentes.map((c) => c.slice(RAIZ.length + 1)),
      "catálogo fora de dia: rode pnpm tsx scripts/gerar-catalogo-de-extensoes.ts",
    ).toEqual([]);
  });

  it("toda entrada tem quem publicou — a loja afirma autoria, o pacote não", () => {
    const semAutoria = catalogo.entries.filter((e) => !e.publisher_label);
    expect(semAutoria.map((e) => `${e.publisher}/${e.name}`)).toEqual([]);
  });

  it("a origem é https, sem credencial — e SEM CAMINHO", () => {
    const url = new URL(catalogo.origin);
    expect(url.protocol).toBe("https:");
    expect(url.username).toBe("");
    expect(url.search).toBe("");
    // O host monta `/packages/<sha256>.json` em cima da origem, então caminho aqui quebraria
    // o endereço do pacote. É por isso que GitHub Pages de PROJETO não serve como origem:
    // `https://usuario.github.io/REPO` tem caminho e é recusado por parseCatalog.
    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("");
  });
});
