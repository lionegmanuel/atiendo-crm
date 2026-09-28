/**
 * A URL de política de privacidade do operador é o único dado de tenant que
 * sai de `/legal/*` — uma rota PÚBLICA — e ela vem de um campo que qualquer
 * admin de organização preenche na tela de Organização.
 *
 * O schema que a valida hoje (`lib/schemas/settings.ts`) usa `z.string().url()`,
 * e `url()` do zod aceita `javascript:alert(1)`: é um esquema válido de URL.
 * Renderizar isso num `<a href>` é XSS; passar para `redirect()` é
 * open-redirect. Nos dois casos a origem é um campo de texto de tenant, ou
 * seja: um admin comprometido alcança visitantes anônimos.
 *
 * Por isso a checagem não é do schema — é deste ponto, na saída.
 */
import { describe, expect, it } from "vitest";

import { urlDePoliticaSegura } from "@/lib/legal/operador";

describe("urlDePoliticaSegura", () => {
  it("aceita as duas origens que um navegador entende como página", () => {
    expect(urlDePoliticaSegura("https://empresa.com.br/privacidade")).toBe(
      "https://empresa.com.br/privacidade",
    );
    // http entra porque instalação em rede interna sem TLS é caso real de
    // self-host; quem publica na internet usa https e o proxy cuida do resto.
    expect(urlDePoliticaSegura("http://intranet.local/privacidade")).toBe(
      "http://intranet.local/privacidade",
    );
  });

  it("RECUSA javascript: — que o validador do formulário deixa passar", () => {
    // A prova de que a guarda não é redundante: este valor É gravável hoje.
    expect(urlDePoliticaSegura("javascript:alert(1)")).toBeNull();
    expect(urlDePoliticaSegura("JavaScript:alert(1)")).toBeNull();
  });

  it("RECUSA data: e outros esquemas que não são página", () => {
    expect(urlDePoliticaSegura("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(urlDePoliticaSegura("file:///etc/passwd")).toBeNull();
    expect(urlDePoliticaSegura("vbscript:msgbox(1)")).toBeNull();
  });

  it("ausente, vazio ou não-texto = sem política própria (não é erro)", () => {
    // O campo é opcional: a maioria das instalações nunca o preenche, e o
    // documento padrão do produto atende. Tratar isso como falha faria a página
    // quebrar para quase todo mundo.
    expect(urlDePoliticaSegura(null)).toBeNull();
    expect(urlDePoliticaSegura(undefined)).toBeNull();
    expect(urlDePoliticaSegura("   ")).toBeNull();
    expect(urlDePoliticaSegura(42)).toBeNull();
    expect(urlDePoliticaSegura("nem-parece-url")).toBeNull();
  });
});
