/**
 * O ESTADO DE UM CANAL NÃO CHEGA CRU À TELA — nem o nome interno da sessão.
 *
 * ═══ O QUE ISTO GUARDA ═══
 *
 * Medido percorrendo o produto: o seletor "Número conectado" do editor de agente
 * lia literalmente `org_2dd5e6ea · STARTING`. Dois vazamentos num campo só — o
 * identificador que nós geramos para o transporte, e o enum em inglês do banco.
 *
 * ⚠️ A GUARDA QUE EXISTIA NÃO PEGAVA ISSO. `wizard-do-funcionario.spec.ts` já
 * proibia estado cru, mas com a regex `/Status:\s*(INIT|STARTING|…)/` — o prefixo
 * literal "Status:" veio do jeito que o wizard formatava, e o defeito de outra
 * tela não tem esse prefixo. Uma guarda ancorada no formato de UM lugar não
 * cobre a família; por isso esta varre o FONTE, não o texto renderizado.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ESTADOS_DO_CANAL,
  lerEstadoDoCanal,
  nomeDoCanal,
  rotuloDoEstadoDoCanal,
} from "@/lib/channels/estado";

function arquivosDeTela(raiz: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        if (nome === "node_modules" || nome === ".next") continue;
        andar(caminho);
      } else if (/\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome)) {
        saida.push(caminho);
      }
    }
  };
  andar(raiz);
  return saida;
}

const TELAS = [...arquivosDeTela("app"), ...arquivosDeTela("components")];

describe("o vocabulário do estado do canal", () => {
  it("cobre exatamente os cinco valores que o banco aceita", () => {
    // `channel_sessions_status_check` — medido no banco:
    // CHECK (status = ANY (ARRAY['STARTING','SCAN_QR_CODE','WORKING','STOPPED','FAILED']))
    expect([...ESTADOS_DO_CANAL].sort()).toEqual(
      ["FAILED", "SCAN_QR_CODE", "STARTING", "STOPPED", "WORKING"].sort(),
    );
  });

  it("nenhum rótulo é o próprio enum", () => {
    // O defeito de origem era um `?? status` no fim da função: quando o estado
    // não estava no mapa, a tela mostrava o enum e ninguém percebia.
    for (const e of ESTADOS_DO_CANAL) {
      expect(rotuloDoEstadoDoCanal(e), e).not.toBe(e);
      expect(rotuloDoEstadoDoCanal(e), e).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("estado fora do vocabulário não vaza o valor cru", () => {
    // Isto também lê estado que veio da API do transporte, e ela não tem
    // contrato com o nosso CHECK. O valor cru pertence ao log, não à tela.
    const l = lerEstadoDoCanal("SOMETHING_NEW");
    expect(l.rotulo).not.toContain("SOMETHING_NEW");
    expect(l.utilizavel).toBe(false);
    expect(lerEstadoDoCanal(null).rotulo).not.toBe("null");
  });

  it("só WORKING é utilizável", () => {
    const uteis = ESTADOS_DO_CANAL.filter((e) => lerEstadoDoCanal(e).utilizavel);
    expect(uteis).toEqual(["WORKING"]);
  });
});

describe("o nome do canal", () => {
  it("nunca é o identificador interno da sessão", () => {
    // `waha_session_name` era o segundo degrau da cadeia em `selectable.ts`, e
    // por isso um canal sem apelido virava a opção `org_2dd5e6ea`.
    const semNome = nomeDoCanal({ display_name: null, phone_number: null });
    expect(semNome).toBe("Número sem nome");
    expect(semNome).not.toMatch(/^org_/);
  });

  it("prefere o apelido, depois o telefone", () => {
    expect(nomeDoCanal({ display_name: "Vendas", phone_number: "5511999" })).toBe("Vendas");
    expect(nomeDoCanal({ display_name: null, phone_number: "5511999" })).toBe("5511999");
    // Apelido só de espaço não conta como apelido.
    expect(nomeDoCanal({ display_name: "   ", phone_number: "5511999" })).toBe("5511999");
  });
});

describe("as telas", () => {
  it("nenhuma monta rótulo com o nome interno da sessão", () => {
    // `waha_session_name` pode ser LIDO por uma tela (a de Conexões pergunta
    // "este canal vive no transporte?" por ele) — o que não pode é virar texto
    // para o usuário. O padrão abaixo é o da cadeia de fallback de NOME.
    const infratores = TELAS.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /(display_name|apelido)[^\n]{0,40}\?\?[^\n]{0,20}waha_session_name/.test(src) ||
        /waha_session_name\s*\|\|\s*["'`]/.test(src) ||
        /(display_name[^\n]{0,30}\|\|[^\n]{0,30}waha_session_name)/.test(src);
    });
    expect(
      infratores,
      "o identificador do transporte não pode ser o nome que o usuário lê",
    ).toEqual([]);
  });

  it("nenhum seletor de canal imprime o estado cru", () => {
    // O JSX exato do defeito: `· {s.status}` dentro de um <SelectItem>. Ele
    // existia em DUAS telas (agente e roteadores) — o mesmo trecho copiado.
    const infratores = TELAS.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /·\s*\{\s*[a-z]\.status\s*\}/.test(src) || /\{\s*[a-z]\.status\s*\}\s*<\/SelectItem>/.test(src);
    });
    expect(infratores, "traduza com `rotuloDoEstadoDoCanal`").toEqual([]);
  });
});
