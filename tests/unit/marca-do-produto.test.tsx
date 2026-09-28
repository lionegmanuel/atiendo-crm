import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/shell/Sidebar";
import { COR_DO_ISOTIPO, LogotipoDoProduto, SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { DEFAULT_APP_NAME, marcaEhADoProduto, type Branding } from "@/lib/branding";
import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";

/**
 * Sem logo, a marca DINÂMICA (isotipo + nome em vigor) aparece — com qualquer APP_NAME.
 *
 * O desenho vive em `components/branding/MarcaDoProduto.tsx` e a decisão em `marcaEhADoProduto`.
 * Este arquivo mede as duas metades: a regra pura, e a regra ALCANÇANDO a
 * barra lateral (conferir que a Sidebar importa o componente não bastaria — é
 * evidência de símbolo, não de comportamento).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));

const usuario = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@exemplo.test",
  is_platform_admin: false,
  organizations: [],
} as unknown as AuthUser;
const org = {
  orgId: "00000000-0000-4000-8000-0000000000aa",
  name: "Loja da Ana",
  role: "admin",
} as ActiveOrg;
let contexto: { user: AuthUser; activeOrg: ActiveOrg | null } = { user: usuario, activeOrg: org };
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => contexto }));

const PADRAO: Branding = { name: DEFAULT_APP_NAME, logoUrl: null, initial: "D" };

function renderSidebar(marca: Branding, collapsed: boolean) {
  return render(
    <MarcaDaInstalacaoProvider marca={marca}>
      <Sidebar collapsed={collapsed} />
    </MarcaDaInstalacaoProvider>,
  );
}

afterEach(() => {
  cleanup();
  contexto = { user: usuario, activeOrg: org };
});

describe("marcaEhADoProduto", () => {
  it("é verdade sempre que não há logo — com o nome padrão", () => {
    expect(marcaEhADoProduto(PADRAO)).toBe(true);
  });

  it("e também com o nome do .env: a marca dinâmica não depende de nome fixo", () => {
    expect(marcaEhADoProduto({ name: "Acme CRM", logoUrl: null })).toBe(true);
  });

  it("quem subiu logo já tem o dele", () => {
    expect(marcaEhADoProduto({ name: DEFAULT_APP_NAME, logoUrl: "https://cdn.x/logo.png" })).toBe(
      false,
    );
  });
});

describe("o desenho na barra lateral", () => {
  it("aberta e sem logo, mostra isotipo + nome (sem <img>)", () => {
    renderSidebar({ name: "Empresa Demo", logoUrl: null, initial: "E" }, false);
    expect(screen.getByRole("img", { name: "Empresa Demo" })).toBeTruthy();
    // O e2e `marca-logo.spec.ts` lê "barra sem <img>" como "sem logo do revendedor".
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("Empresa Demo")).toBeTruthy();
  });

  it("recolhida, mostra o isotipo com a inicial do nome em vigor", () => {
    renderSidebar({ name: "Empresa Demo", logoUrl: null, initial: "E" }, true);
    const isotipo = screen.getByRole("img", { name: "Empresa Demo" });
    expect(isotipo.tagName.toLowerCase()).toBe("svg");
    expect(isotipo.textContent).toBe("E");
  });

  it("com nome da ORGANIZAÇÃO sobre a instalação, o nome dela vence", () => {
    contexto = { user: usuario, activeOrg: { ...org, marca: { nome: "Loja da Ana" } } };
    renderSidebar(PADRAO, false);
    expect(screen.getByRole("img", { name: "Loja da Ana" })).toBeTruthy();
    expect(screen.getByText("Loja da Ana")).toBeTruthy();
  });

  it("com logo da instalação, a imagem vence o desenho", () => {
    renderSidebar({ ...PADRAO, logoUrl: "https://cdn.exemplo.test/logo.png" }, false);
    expect(screen.getByRole("img").tagName.toLowerCase()).toBe("img");
  });
});

describe("o componente", () => {
  it("decorativo esconde do leitor de tela; sem isso, nomeia a marca", () => {
    render(<SimboloDoProduto nome="Marca X" decorativo />);
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    render(<LogotipoDoProduto nome="Marca X" />);
    expect(screen.getByRole("img", { name: "Marca X" })).toBeTruthy();
  });

  it("o isotipo usa o acento esmeralda", () => {
    render(<SimboloDoProduto nome="Marca X" />);
    expect(document.querySelector("rect")?.getAttribute("fill")).toBe(COR_DO_ISOTIPO);
  });
});

describe("o favicon segue a mesma regra", () => {
  const icone = fs.readFileSync(path.join(process.cwd(), "app/icon.tsx"), "utf8");

  it("sem logo, desenha o isotipo esmeralda com a inicial do nome em vigor", () => {
    expect(icone).toMatch(/marcaEhADoProduto\(\{ name: marca\.nome, logoUrl: marca\.logoUrl \}\)/);
    expect(icone).toMatch(/background: COR_DO_ISOTIPO/);
    expect(icone).toMatch(/letraDoIcone\(marca\.nome\)/);
  });
});
