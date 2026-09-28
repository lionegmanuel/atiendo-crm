import { describe, expect, it } from "vitest";

import { derivarMarca } from "@/lib/branding/contraste";
import {
  marcaDaOrganizacaoDeSettings,
  resolverMarcaDaOrganizacao,
} from "@/lib/branding/organizacao";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";
import { camadaDaOrganizacao, resolverMarca } from "@/lib/branding/resolve";

/**
 * A CAMADA DA ORGANIZAÇÃO NA PILHA — precedência, silêncio e o teto do cache.
 *
 * A pilha passa a ter três andares: organização (o cliente final), instalação (o
 * revendedor, em `platform_branding`) e `.env` (a semente e a rede de rollback).
 * O que esta suíte guarda é o comportamento das BORDAS, que é onde a precedência
 * por campo costuma virar precedência por objeto sem ninguém perceber:
 *
 *   - organização com cor válida VENCE a instalação;
 *   - organização SEM cor cai na instalação **em silêncio** — aviso no caso
 *     normal é como um operador aprende a ignorar aviso;
 *   - organização com hex INVÁLIDO cai na instalação **com motivo**, porque aí
 *     alguém digitou algo e precisa saber por que não pintou.
 *
 * Os dois últimos são o mesmo desfecho visual e comportamentos opostos — se o
 * teste medisse só a cor final, os dois passariam com a implementação errada.
 */

/** A instalação (o revendedor) com marca completa — o andar de baixo dos testes. */
const INSTALACAO = {
  app_name: "Revenda XPTO",
  logo_url: "https://cdn.exemplo.com/revenda.svg",
  accent_hex: "#2563eb",
};

const AMBIENTE = { APP_NAME: "Do env", APP_ACCENT_HEX: "#123456" };

describe("camadaDaOrganizacao — o que a fábrica declara e o que ela cala", () => {
  it("sem marca nenhuma, a camada não fala de nada", () => {
    // `{ origem }` e não `{ origem, nome: null, cor: null }`: campo AUSENTE desce
    // calado, campo presente e nulo vira `cor_ausente`. É a diferença entre "a
    // organização não configurou" e "a organização configurou vazio".
    expect(camadaDaOrganizacao(null)).toEqual({ origem: "organizacao" });
    expect("cor" in camadaDaOrganizacao(null)).toBe(false);
  });

  it("hex vazio devolve camada SEM a chave `cor`", () => {
    for (const vazio of ["", "   ", null, undefined]) {
      const camada = camadaDaOrganizacao({ app_name: "Loja da Ana", accent_hex: vazio });
      expect("cor" in camada, `hex ${JSON.stringify(vazio)} declarou cor`).toBe(false);
      expect(camada.nome).toBe("Loja da Ana");
    }
  });

  /**
   * ESTE CASO TROCOU DE AFIRMAÇÃO, E A ANTIGA ESTÁ AQUI DE PROPÓSITO.
   *
   * Ele congelava "NUNCA declara logo — upload é a fase seguinte", com a razão
   * de que uma camada declarando `logoUrl: null` ensinaria a próxima pessoa a
   * achar que o campo já existia. A fase seguinte é ESTA: `camadaDaOrganizacao`
   * passou a declarar o logo a partir de `settings.branding.logo_path`. Apagar o
   * caso e seguir deixaria a propriedade que sobrou — `null` é NEUTRO, não apaga
   * a camada de baixo — sem nenhuma guarda, que é justamente o modo de falha que
   * o caso antigo protegia por outro caminho.
   */
  it("declara logo, e `null` continua sendo NEUTRO (não apaga a camada de baixo)", () => {
    expect("logoUrl" in camadaDaOrganizacao({ app_name: "Loja da Ana" })).toBe(true);
    expect(camadaDaOrganizacao({ app_name: "Loja da Ana" }).logoUrl).toBeNull();
    expect(camadaDaOrganizacao({ accent_hex: "#b3261e" }).logoUrl).toBeNull();

    // Sem `logo_path`, a instalação continua sendo quem pinta o logo — a
    // asserção de que `null` desce em vez de apagar.
    const marca = resolverMarcaDaOrganizacao(
      { branding: { app_name: "Loja da Ana" } },
      INSTALACAO,
      AMBIENTE,
    );
    expect(marca.origens.logoUrl).not.toBe("organizacao");
  });

  it("um hex vira envelope da versão de hoje, não a rampa derivada", () => {
    // O que se grava é ENTRADA. Se algum dia a camada montar a saída, uma
    // correção no gerador de contraste deixa de alcançar quem já configurou.
    const camada = camadaDaOrganizacao({ accent_hex: "#B3261E" });
    expect(camada.cor).toMatchObject({ semente_hex: "#b3261e", papel_da_semente: "accent" });
  });
});

describe("precedência entre os três andares", () => {
  it("a cor da ORGANIZAÇÃO vence a da instalação", () => {
    const marca = resolverMarcaDaOrganizacao(
      { branding: { accent_hex: "#b3261e" } },
      INSTALACAO,
      AMBIENTE,
    );
    expect(marca.origens.cor).toBe("organizacao");
    expect(marca.cor?.semente).toBe("#b3261e");
    // E o resto continua vindo de baixo — precedência é POR CAMPO.
    expect(marca.name).toBe("Revenda XPTO");
    expect(marca.logoUrl).toBe("https://cdn.exemplo.com/revenda.svg");
    expect(marca.origens.logoUrl).toBe("banco");
  });

  it("o nome da ORGANIZAÇÃO vence sem arrastar a cor junto", () => {
    const marca = resolverMarcaDaOrganizacao(
      { branding: { app_name: "Loja da Ana" } },
      INSTALACAO,
      AMBIENTE,
    );
    expect(marca.name).toBe("Loja da Ana");
    expect(marca.origens.nome).toBe("organizacao");
    expect(marca.origens.cor).toBe("banco");
    expect(marca.cor?.semente).toBe("#2563eb");
  });

  it("organização SEM cor cai na instalação e NÃO emite motivo", () => {
    // Este é o caso normal de toda organização que nunca abriu a tela de marca.
    // Um `cor_ausente` aqui acenderia aviso em todas elas, e o aviso que aparece
    // sempre é o que ninguém lê quando importa.
    for (const settings of [
      {},
      { branding: {} },
      { branding: { app_name: "Loja da Ana" } },
      { branding: { app_name: "Loja da Ana", accent_hex: null } },
      { branding: { app_name: "Loja da Ana", accent_hex: "  " } },
    ]) {
      const marca = resolverMarcaDaOrganizacao(settings, INSTALACAO, AMBIENTE);
      expect(marca.origens.cor, JSON.stringify(settings)).toBe("banco");
      expect(
        marca.motivos.filter((m) => m.origem === "organizacao"),
        `motivo emitido para ${JSON.stringify(settings)}`,
      ).toEqual([]);
    }
  });

  it("organização com hex INVÁLIDO cai na instalação e EMITE motivo", () => {
    // Mesmo desfecho visual do caso acima, comportamento oposto: aqui alguém
    // digitou algo e precisa descobrir por que não pintou — é o laço de retorno
    // da feature. Cair na cor do REVENDEDOR (e não na do produto) também é a
    // decisão certa: numa instalação de revendedor, trocar para a nossa cor
    // trocaria o dono da tela.
    const marca = resolverMarcaDaOrganizacao(
      { branding: { accent_hex: "vermelho" } },
      INSTALACAO,
      AMBIENTE,
    );
    expect(marca.origens.cor).toBe("banco");
    expect(marca.cor?.semente).toBe("#2563eb");
    const daOrg = marca.motivos.filter((m) => m.origem === "organizacao");
    expect(daOrg.map((m) => m.codigo)).toEqual(["semente_invalida"]);
    // E o diagnóstico não carrega identidade: nenhum hex de ninguém no texto.
    for (const m of daOrg) expect(m.detalhe).not.toContain("#2563eb");
  });

  it("sem organização e sem instalação, sobra o `.env` — a pilha inteira desce", () => {
    const marca = resolverMarcaDaOrganizacao(null, null, AMBIENTE);
    expect(marca.origens).toEqual({ nome: "env", logoUrl: "padrao", cor: "env" });
    expect(marca.cor?.semente).toBe("#123456");
  });

  it("com os TRÊS andares falando ao mesmo tempo, a ordem é org > instalação > env", () => {
    // Testar caminhos não é testar a ORDEM: os casos acima exercitam um andar de
    // cada vez, e passariam iguais com duas camadas trocadas de lugar. Este liga
    // as três condições juntas, que é a única forma de a precedência aparecer.
    const tudo = resolverMarcaDaOrganizacao(
      { branding: { app_name: "Loja da Ana", accent_hex: "#b3261e" } },
      INSTALACAO,
      AMBIENTE,
    );
    expect(tudo.origens).toEqual({ nome: "organizacao", logoUrl: "banco", cor: "organizacao" });
    expect(tudo.name).toBe("Loja da Ana");
    expect(tudo.cor?.semente).toBe("#b3261e");

    // Tirando o andar de cima, quem assume é o do meio — e não o de baixo.
    const semOrg = resolverMarcaDaOrganizacao(null, INSTALACAO, AMBIENTE);
    expect(semOrg.origens).toEqual({ nome: "banco", logoUrl: "banco", cor: "banco" });
    expect(semOrg.cor?.semente).toBe("#2563eb");
  });
});

describe("ler `settings.branding` sem confiar em nada", () => {
  it("jsonb que não é objeto vira `null`, sem lançar", () => {
    // `settings` é jsonb livre: escrita manual, versão futura e migração pela
    // metade cabem lá. Isto roda no layout que embrulha `/app` inteiro — uma
    // exceção aqui é 500 em todas as telas do tenant, inclusive na tela onde o
    // admin corrigiria o valor.
    for (const lixo of [null, undefined, 42, "texto", [1, 2], { branding: 42 }, { branding: "azul" }, { branding: [1] }]) {
      expect(() => marcaDaOrganizacaoDeSettings(lixo)).not.toThrow();
      expect(marcaDaOrganizacaoDeSettings(lixo), JSON.stringify(lixo) ?? "undefined").toBeNull();
    }
  });

  it("campo de tipo errado vira `null`, não desce para a derivação", () => {
    // Um `accent_hex` numérico produziria um `envelope_malformado` apontando para
    // o campo errado no diagnóstico — o admin procuraria o defeito no lugar errado.
    expect(
      marcaDaOrganizacaoDeSettings({
        branding: { app_name: 7, accent_hex: { a: 1 }, logo_path: ["x"] },
      }),
    ).toEqual({ app_name: null, accent_hex: null, logo_path: null });
  });

  it("lê os dois campos e ignora o que não conhece", () => {
    // Chave desconhecida é código velho lendo dado novo — o estado NORMAL de um
    // rollback do kit, não a exceção.
    expect(
      marcaDaOrganizacaoDeSettings({
        visibility_mode: "own",
        branding: {
          app_name: "Loja da Ana",
          accent_hex: "#b3261e",
          logo_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
          // `logo_url` NÃO é lido nesta camada, e continua no fixture de
          // propósito: é chave que existe no jsonb de clones antigos e a
          // asserção de que ela é IGNORADA é a metade do caso que uma leitura
          // "por spread" quebraria em silêncio.
          logo_url: "https://x/y.svg",
          updated_by: "u",
        },
      }),
    ).toEqual({
      app_name: "Loja da Ana",
      accent_hex: "#b3261e",
      logo_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
    });
  });
});

describe("o teto do cache de derivação", () => {
  /** Régua PRÓPRIA: o `WeakMap` é chaveado por identidade, então nada vaza para o produto. */
  const reguaIsolada = () => ({ ...REGUA_DO_PRODUTO });

  const hexDe = (i: number) => `#${(0x110000 + i * 7).toString(16).padStart(6, "0").slice(-6)}`;

  const derivadaDe = (hex: string, regua: typeof REGUA_DO_PRODUTO) =>
    resolverMarca([camadaDaOrganizacao({ accent_hex: hex })], regua).cor?.derivada;

  it("a mesma semente reusa o objeto derivado — guarda de vacuidade do teto", () => {
    // Sem esta, o caso abaixo passaria com o cache DESLIGADO: dois objetos
    // diferentes é exatamente o que "não tem cache" também produz.
    const regua = reguaIsolada();
    expect(derivadaDe("#14b8a6", regua)).toBe(derivadaDe("#14b8a6", regua));
  });

  it("a semente mais ANTIGA cai fora quando o teto estoura", () => {
    // É esta fase que transforma "uma semente por instalação" em "uma por
    // organização": sem poda, o `Map` cresce com o número de empresas que abrem
    // uma tela, num processo que a VPS mantém vivo por semanas.
    const regua = reguaIsolada();
    const primeira = derivadaDe("#010101", regua);
    expect(primeira).toBeDefined();

    // 64 sementes distintas DEPOIS da primeira: a inserção de número 65 é a que
    // ultrapassa o teto e despeja a mais antiga, que é a primeira.
    const sementes = new Set<string>();
    for (let i = 0; sementes.size < 64; i++) {
      const hex = hexDe(i);
      if (hex === "#010101") continue;
      sementes.add(hex);
      derivadaDe(hex, regua);
    }

    const depois = derivadaDe("#010101", regua);
    expect(depois, "a primeira semente sobreviveu ao teto — o `Map` não poda").not.toBe(primeira);
    // E o que volta é a derivação certa, não uma cópia velha ou um objeto vazio:
    // um teto que corrompesse o valor seria pior que teto nenhum.
    expect(depois).toEqual(derivarMarca("#010101", regua));
  });

  it("a semente mais RECENTE continua no cache depois do despejo", () => {
    // O par do caso acima: FIFO despeja a mais antiga, não esvazia o cache. Sem
    // este, uma implementação que fizesse `porSemente.clear()` passaria igual — e
    // aí a derivação volta a rodar por requisição, que é o custo que o cache
    // existe para evitar.
    const regua = reguaIsolada();
    for (let i = 0; i < 64; i++) derivadaDe(hexDe(i), regua);
    const recente = derivadaDe("#fedcba", regua);
    expect(derivadaDe("#fedcba", regua)).toBe(recente);
  });
});
