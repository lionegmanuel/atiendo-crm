/**
 * A MARCA DA INSTALAÇÃO NO BANCO — as decisões, sem I/O.
 *
 * Este arquivo cobre o que decide, não o que grava: semeadura, o que conta como
 * fallback, e a camada do banco dentro da precedência. O que exige um Postgres
 * de verdade (RLS, privilégios, CHECK, trigger) vive em
 * `tests/invariants/marca-da-instalacao.test.ts` — e as duas coisas são
 * diferentes: catálogo passa verde com a decisão errada, e decisão passa verde
 * com a tabela exposta.
 *
 * As funções puras são exportadas DE PROPÓSITO. A alternativa era testar tudo
 * por trás de um mock do cliente Supabase, e mock do transporte prova que a
 * query foi montada — nunca que a regra está certa.
 */
import { describe, expect, it } from "vitest";

import {
  motivoDoFallback,
  precisaSemear,
  sementeDoAmbiente,
  type LinhaDaMarca,
} from "@/lib/branding/instalacao";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";
import {
  camadaDaInstalacao,
  camadaDoAmbiente,
  resolverMarca,
} from "@/lib/branding/resolve";

const REGUA = REGUA_DO_PRODUTO;

/** Uma linha completa, com os campos que o caso quiser trocar. */
function linha(patch: Partial<LinhaDaMarca> = {}): LinhaDaMarca {
  return {
    app_name: null,
    logo_url: null,
    accent_hex: null,
    show_powered_by: true,
    seeded_from_env: true,
    fallback_at: null,
    fallback_reason: null,
    ...patch,
  };
}

describe("o que o `.env` promove", () => {
  it("ambiente sem marca nenhuma não promove nada", () => {
    // `install.sh` grava as chaves declaradas e VAZIAS quando o operador não
    // responde. Se isso virasse semente, toda instalação de fábrica ganharia uma
    // linha de três nulos — e `precisaSemear` a trataria como "vazia" para
    // sempre, batendo no banco em todo render.
    expect(sementeDoAmbiente({})).toBeNull();
    expect(sementeDoAmbiente({ APP_NAME: "", APP_LOGO_URL: "", APP_ACCENT_HEX: "" })).toBeNull();
    expect(sementeDoAmbiente({ APP_NAME: "   " })).toBeNull();
  });

  it("promove só o que existe, e o resto fica null", () => {
    expect(sementeDoAmbiente({ APP_NAME: "  Revenda XPTO  " })).toEqual({
      app_name: "Revenda XPTO",
      logo_url: null,
      accent_hex: null,
    });
  });

  it("NORMALIZA o hex antes de gravar", () => {
    // O CHECK do banco é `^#[0-9a-f]{6}$`. Gravar `#FFF` cru derrubaria o INSERT
    // com um 23514 que ninguém saberia ler; gravar `#FFFFFF` criaria duas
    // grafias da mesma cor e faria a pergunta "mudou?" mentir.
    expect(sementeDoAmbiente({ APP_ACCENT_HEX: "#FFF" })?.accent_hex).toBe("#ffffff");
    expect(sementeDoAmbiente({ APP_ACCENT_HEX: " #2563EB " })?.accent_hex).toBe("#2563eb");
  });

  it("hex inválido NÃO é promovido, mas o resto da marca é", () => {
    // Falhar fechado na AÇÃO (não gravar lixo que a constraint recusaria) e
    // aberto na INFORMAÇÃO: o valor continua no `.env`, e a camada do ambiente o
    // recusa com motivo — que é onde o operador enxerga o erro.
    const semente = sementeDoAmbiente({ APP_NAME: "Revenda XPTO", APP_ACCENT_HEX: "azul" });
    expect(semente).toEqual({ app_name: "Revenda XPTO", logo_url: null, accent_hex: null });
  });

  it("hex inválido SOZINHO não gera semente nenhuma", () => {
    expect(sementeDoAmbiente({ APP_ACCENT_HEX: "#gg0011" })).toBeNull();
  });
});

describe("quando semear (e quando NÃO)", () => {
  const semente = { app_name: "Revenda XPTO", logo_url: null, accent_hex: "#2563eb" };

  it("linha ausente com semente → inserir", () => {
    expect(precisaSemear(null, semente)).toBe("inserir");
  });

  it("sem semente não se faz nada, nem quando a linha não existe", () => {
    // Uma linha de três nulos não é configuração: é ruído que o render seguinte
    // reencontra vazia e volta a tentar preencher.
    expect(precisaSemear(null, null)).toBe("nao");
    expect(precisaSemear(linha(), null)).toBe("nao");
  });

  it("linha semeada e VAZIA → completar", () => {
    // O caso real do kit: `APP_NAME` é a ÚLTIMA pergunta da entrevista e pode
    // ser pulada. O operador preenche o `.env` depois — sem `completar`, a linha
    // vazia do primeiro render travaria a promoção para sempre.
    expect(precisaSemear(linha({ seeded_from_env: true }), semente)).toBe("completar");
  });

  it("linha semeada e PREENCHIDA não é semeada de novo", () => {
    expect(precisaSemear(linha({ app_name: "Já Tem" }), semente)).toBe("nao");
    // Um campo só já basta para não ser "vazia": completar aqui sobrescreveria
    // um valor existente com o do `.env`.
    expect(precisaSemear(linha({ logo_url: "https://x.test/l.svg" }), semente)).toBe("nao");
  });

  it("LINHA HUMANA VAZIA NUNCA É SEMEADA — é o que protege quem apagou de propósito", () => {
    // A guarda mais importante do arquivo. A escrita pela tela zera
    // `seeded_from_env`; se a semeadura ignorasse isso, o operador que apagou os
    // três campos para voltar ao padrão do produto veria o `.env` reescrevê-los
    // no render seguinte — e concluiria, com razão, que o campo não funciona.
    expect(precisaSemear(linha({ seeded_from_env: false }), semente)).toBe("nao");
  });
});

describe("o que conta como FALLBACK (e o que é só ruído)", () => {
  it("sem motivo nenhum, não há alarme", () => {
    expect(motivoDoFallback([])).toBeNull();
  });

  it("motivo de MOVIMENTO não acende o alarme", () => {
    // A cor PINTOU — só andou na rampa. Isso acontece em quase toda marca; se
    // contasse, `fallback_at` ficaria aceso sempre e ninguém olharia de novo.
    expect(
      motivoDoFallback([
        { codigo: "accent_deslocado", alvo: "--color-accent" },
        { codigo: "semantica_deslocada", alvo: "--color-success" },
        { codigo: "marca_acromatica", alvo: null },
      ]),
    ).toBeNull();
  });

  it("`accent_sem_contraste_possivel` NÃO é fallback — é degradação", () => {
    // A distinção é o contrato do nome da coluna: aqui o produto pinta a cor do
    // cliente mesmo assim, fora do piso. Fallback é quando ele NÃO pinta.
    expect(motivoDoFallback([{ codigo: "accent_sem_contraste_possivel", alvo: null }])).toBeNull();
  });

  it("dívida declarada da fase não é falha do operador", () => {
    // `token_nao_serializado` diz que as semânticas não saem no CSS desta fase —
    // decisão nossa, não erro de quem configurou a cor.
    expect(motivoDoFallback([{ codigo: "token_nao_serializado", alvo: "--color-success" }])).toBeNull();
  });

  it("`algoritmo_desconhecido` não é fallback — é exatamente o rollback funcionando", () => {
    // A linha foi gravada por uma versão que deriva diferente; esta versão usa a
    // SEMENTE como entrada e pinta. Acender alarme aí acusaria de defeito o
    // comportamento que mantém a marca no ar durante um rollback.
    expect(motivoDoFallback([{ codigo: "algoritmo_desconhecido", alvo: null }])).toBeNull();
  });

  it("recusa da serialização acende, com o alvo junto", () => {
    expect(
      motivoDoFallback([{ codigo: "valor_fora_da_allowlist", alvo: "--color-accent" }]),
    ).toBe("valor_fora_da_allowlist@--color-accent");
  });

  it("recusa da resolução acende", () => {
    expect(motivoDoFallback([{ codigo: "semente_invalida", alvo: null }])).toBe(
      "semente_invalida",
    );
  });

  it("junta as recusas ordenadas e sem repetir, ignorando o ruído em volta", () => {
    expect(
      motivoDoFallback([
        { codigo: "semantica_deslocada", alvo: "--color-success" },
        { codigo: "valor_fora_da_allowlist", alvo: "--color-accent" },
        { codigo: "envelope_malformado", alvo: null },
        { codigo: "valor_fora_da_allowlist", alvo: "--color-accent" },
      ]),
    ).toBe("envelope_malformado, valor_fora_da_allowlist@--color-accent");
  });

  it("nenhum hex de marca entra no motivo", () => {
    // FORMA, nunca IDENTIDADE. `fallback_reason` é coluna que o suporte lê, e
    // com a tabela por organização (fase seguinte) esses motivos passam a
    // conviver num lugar só.
    const motivo = motivoDoFallback([
      { codigo: "valor_fora_da_allowlist", alvo: "--color-accent" },
      { codigo: "semente_invalida", alvo: null },
    ]);
    expect(motivo).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("corta motivo gigante em vez de deixar `text` sem teto", () => {
    const muitos = Array.from({ length: 200 }, (_, i) => ({
      codigo: "valor_fora_da_allowlist",
      alvo: `--color-token-numero-${i}`,
    }));
    const motivo = motivoDoFallback(muitos);
    expect(motivo).not.toBeNull();
    expect(motivo!.length).toBeLessThanOrEqual(500);
    expect(motivo!.endsWith("…")).toBe(true);
  });
});

describe("a camada do banco dentro da precedência", () => {
  const ambiente = camadaDoAmbiente({
    APP_NAME: "Revenda XPTO",
    APP_LOGO_URL: "https://cdn.exemplo.com/revenda.svg",
    APP_ACCENT_HEX: "#2563eb",
  });

  it("banco ausente NÃO apaga o `.env` — é a rede de segurança do rollback", () => {
    // Banco fora do ar, tabela ainda não criada (código novo sobre schema
    // velho), linha não semeada: a marca da instalação tem de continuar de pé.
    const marca = resolverMarca([camadaDaInstalacao(null), ambiente], REGUA);
    expect(marca.name).toBe("Revenda XPTO");
    expect(marca.origens).toEqual({ nome: "env", logoUrl: "env", cor: "env" });
    expect(marca.cor?.semente).toBe("#2563eb");
  });

  it("banco vence o `.env` quando tem o que dizer", () => {
    const marca = resolverMarca(
      [camadaDaInstalacao({ app_name: "Clínica Sant'Ana", accent_hex: "#7f8c3a" }), ambiente],
      REGUA,
    );
    expect(marca.name).toBe("Clínica Sant'Ana");
    expect(marca.cor?.semente).toBe("#7f8c3a");
    expect(marca.origens).toEqual({ nome: "banco", logoUrl: "env", cor: "banco" });
  });

  it("precedência é POR CAMPO: banco só com nome mantém o logo do `.env`", () => {
    const marca = resolverMarca([camadaDaInstalacao({ app_name: "Só o Nome" }), ambiente], REGUA);
    expect(marca.name).toBe("Só o Nome");
    expect(marca.logoUrl).toBe("https://cdn.exemplo.com/revenda.svg");
    expect(marca.origens.cor).toBe("env");
  });

  it("linha semeada sem cor não emite `cor_ausente`", () => {
    // Instalação de fábrica: o `.env` não tinha cor, a linha foi semeada só com
    // nome. Avisar sobre o caso normal é como se ensina o operador a ignorar
    // avisos.
    const marca = resolverMarca(
      [camadaDaInstalacao({ app_name: "Sem Cor", accent_hex: "" })],
      REGUA,
    );
    expect(marca.motivos.map((m) => m.codigo)).toEqual([]);
    expect(marca.cor).toBeNull();
  });

  it("cor QUEBRADA no banco cai na cor do `.env`, não na do produto", () => {
    // O caminho de rollback pela outra ponta: alguém gravou um hex que este
    // build não aceita. A instalação tem de cair na cor do REVENDEDOR — cair na
    // nossa seria trocar o dono da tela no pior momento.
    const marca = resolverMarca([camadaDaInstalacao({ accent_hex: "azul" }), ambiente], REGUA);
    expect(marca.cor?.semente).toBe("#2563eb");
    expect(marca.origens.cor).toBe("env");
    expect(marca.motivos.map((m) => m.codigo)).toContain("semente_invalida");
  });

  it("uma cor recusada no banco vira FALLBACK gravável", () => {
    // Liga as duas peças: o motivo que a resolução produz é o mesmo que
    // `motivoDoFallback` transforma em estado. Sem este caso, as duas metades
    // poderiam divergir e cada uma passaria sozinha.
    const marca = resolverMarca([camadaDaInstalacao({ accent_hex: "azul" })], REGUA);
    expect(motivoDoFallback(marca.motivos)).toBe("semente_invalida");
  });
});
