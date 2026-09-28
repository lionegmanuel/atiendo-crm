import { describe, expect, it } from "vitest";

import { MARCADOR, acao, colisoes, corpoDoAviso, corpoResolvido, identidade, juntaPaginas, proximoLivre } from "./vigia-colisao-de-migration";

const BASE = [
  "supabase/migrations/20260915193743_0263_etapa_de_perda.sql",
  "supabase/migrations/20260916120000_0266_transferencia.sql",
  "supabase/migrations/20260917034929_0268_regra.sql",
];

describe("identidade", () => {
  it("lê o timestamp e o NNNN do nome", () => {
    expect(identidade("supabase/migrations/20260915193743_0263_x.sql")).toEqual({
      ts: "20260915193743",
      nnnn: "0263",
      nome: "20260915193743_0263_x.sql",
    });
  });

  it("devolve null para nome fora do padrão — sem NNNN não há o que medir", () => {
    expect(identidade("supabase/migrations/leia-me.sql")).toBeNull();
    expect(identidade("supabase/migrations/0263_sem_timestamp.sql")).toBeNull();
  });
});

describe("colisoes", () => {
  it("acha o NNNN tomado e NOMEIA quem o tomou", () => {
    const r = colisoes(["supabase/migrations/20260930120000_0263_meu.sql"], BASE);
    expect(r).toEqual([{ nnnn: "0263", meu: "20260930120000_0263_meu.sql", tomadoPor: "20260915193743_0263_etapa_de_perda.sql" }]);
  });

  it("acha o timestamp repetido, que é a identidade que o Supabase usa", () => {
    const r = colisoes(["supabase/migrations/20260916120000_0999_meu.sql"], BASE);
    expect(r[0]).toMatchObject({ ts: "20260916120000", tomadoPor: "20260916120000_0266_transferencia.sql" });
  });

  it("número livre não vira aviso — é o anti-falso-vermelho", () => {
    expect(colisoes(["supabase/migrations/20260930120000_0300_meu.sql"], BASE)).toEqual([]);
  });

  it("o MESMO arquivo em ambos os lados não é disputa", () => {
    // PR já mesclado em parte, ou que a base já contém: caminho idêntico é o
    // mesmo arquivo. Contar isso como colisão acusaria quem não fez nada.
    expect(colisoes([BASE[0]!], BASE)).toEqual([]);
  });

  it("PR sem migration não produz aviso nenhum", () => {
    expect(colisoes([], BASE)).toEqual([]);
  });
});

describe("proximoLivre", () => {
  it("é o maior da base + 1, e não o último da listagem", () => {
    expect(proximoLivre(BASE)).toBe("0269");
  });
});

describe("corpoDoAviso", () => {
  const corpo = corpoDoAviso(colisoes(["supabase/migrations/20260930120000_0263_meu.sql"], BASE), BASE);

  it("carrega o marcador que reencontra o comentário anterior", () => {
    expect(corpo.startsWith(MARCADOR)).toBe(true);
  });

  it("diz o número, quem o tomou e o próximo livre", () => {
    expect(corpo).toContain("0263");
    expect(corpo).toContain("20260915193743_0263_etapa_de_perda.sql");
    expect(corpo).toContain("0269");
  });

  it("não culpa quem contribuiu", () => {
    expect(corpo).toContain("não é um erro seu");
  });

  it("declara o que NÃO mede", () => {
    expect(corpo, "sem a ressalva, o silêncio sobre ordem semântica lê como aprovação").toContain(
      "ordem semântica",
    );
  });
});

describe("acao — um comentário por PR, editado, nunca repetido", () => {
  const corpo = "x";

  it("sem colisão e sem comentário anterior: não fala", () => {
    expect(acao(null, null)).toEqual({ tipo: "nada" });
  });

  it("colisão nova: cria", () => {
    expect(acao(null, corpo)).toEqual({ tipo: "criar", corpo });
  });

  it("mesmo estado na rodada seguinte: NÃO comenta de novo", () => {
    expect(acao({ id: 7, body: corpo }, corpo)).toEqual({ tipo: "nada" });
  });

  it("estado mudou: edita o mesmo comentário", () => {
    expect(acao({ id: 7, body: "outro" }, corpo)).toEqual({ tipo: "editar", id: 7, corpo });
  });

  it("colisão resolvida: o aviso vira 'resolvido' — não fica afirmando o que já não vale", () => {
    // Achado 8 da revisão do #1268: a primeira versão deixava o comentário
    // dizendo "o número foi tomado" num PR que já tinha renumerado.
    const r = acao({ id: 7, body: corpo }, null);
    expect(r.tipo).toBe("editar");
    expect(r.id).toBe(7);
    expect(r.corpo).toContain("Resolvido");
    expect(r.corpo).toContain(MARCADOR);
  });

  it("já está 'resolvido': não reescreve a cada rodada", () => {
    expect(acao({ id: 7, body: corpoResolvido() }, null)).toEqual({ tipo: "nada" });
  });
});

describe("juntaPaginas — o bug que matou a primeira versão no 16º PR", () => {
  // `gh api --paginate` com `--jq` de ARRAY emite UM ARRAY POR PÁGINA. Medido no
  // #677 (112 comentários, 2 páginas): JSON.parse lança "Unexpected
  // non-whitespace character after JSON at position 1". Sem try/catch por PR,
  // isso derrubava a rodada ANTES de chegar nos PRs que motivaram o trabalho.
  it("uma página só continua funcionando", () => {
    expect(juntaPaginas<{ id: number }>('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("DUAS páginas viram uma lista — era aqui que o JSON.parse morria", () => {
    const duasPaginas = '[{"id":1},{"id":2}]\n[{"id":3}]';
    expect(() => JSON.parse(duasPaginas), "controle: o parse ingênuo tem de morrer").toThrow();
    expect(juntaPaginas<{ id: number }>(duasPaginas)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("saída vazia vira lista vazia, não exceção", () => {
    expect(juntaPaginas("")).toEqual([]);
    expect(juntaPaginas("\n\n")).toEqual([]);
  });

  it("objeto por linha (sem colchetes) também é aceito", () => {
    expect(juntaPaginas<{ id: number }>('{"id":1}\n{"id":2}')).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
