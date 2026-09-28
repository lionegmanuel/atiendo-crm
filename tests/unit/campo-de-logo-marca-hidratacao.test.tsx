/**
 * O marcador de hidratação do campo de logo é CONTRATO com o e2e.
 *
 * `tests/e2e/marca-logo.spec.ts` espera `[data-campo-de-logo][data-hidratado]`
 * antes de `setInputFiles`, porque `setInputFiles` só exige o elemento anexado
 * — e o input existe no HTML do SSR antes de o React atar o `onChange`. Arquivo
 * posto nessa janela não dispara requisição nenhuma.
 *
 * Sem este teste, o atributo sumiria num refactor e o e2e voltaria a ser
 * instável com um sintoma que não fala do defeito ("esperei 15s por um toast").
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CampoDeLogo } from "@/components/branding/CampoDeLogo";

describe("o campo de logo anuncia que hidratou", () => {
  it("depois de montar, o wrapper tem data-hidratado", () => {
    render(
      <CampoDeLogo
        escopo="instalacao"
        logoDaCamada={{ url: null }}
        logoHerdado={null}
        origemDoHerdado="do sistema"
        nomeEmVigor="DeskcommCRM"
      />,
    );
    const campo = document.querySelector("[data-campo-de-logo='instalacao']");
    expect(campo, "o wrapper com data-campo-de-logo é a âncora do e2e").not.toBeNull();
    expect(
      campo!.hasAttribute("data-hidratado"),
      "o e2e espera [data-hidratado] antes de setInputFiles — sem ele, volta a instabilidade",
    ).toBe(true);
  });

  it("o input do arquivo continua com o id que o e2e usa", () => {
    render(
      <CampoDeLogo
        escopo="organizacao"
        logoDaCamada={{ url: null }}
        logoHerdado={null}
        origemDoHerdado="da instalação"
        nomeEmVigor="Empresa"
      />,
    );
    expect(document.querySelector("#logo-organizacao")).not.toBeNull();
  });
});
