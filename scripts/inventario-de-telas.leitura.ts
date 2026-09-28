/**
 * A LEITURA do inventário de telas — parser puro, sem I/O e sem `process.exit`.
 *
 * ## Por que é um módulo separado do script
 *
 * Precedente medido no repo: `scripts/lint-channels.pattern.ts` existe porque o
 * lint varre o disco e chama `process.exit` no topo do módulo — importá-lo de um
 * teste rodaria o lint. Mesma restrição aqui: `scripts/inventario-de-telas.ts` é
 * executável, e `tests/unit/inventario-de-telas.test.ts` precisa do MESMO parser
 * que ele usa. Duas cópias do parser seriam a segunda lista à mão que este
 * arquivo existe para evitar.
 *
 * ## Por que existe controle positivo dentro do parser
 *
 * `lerInventario` devolve conjuntos. Parser de tabela markdown quebrado devolve
 * conjunto **vazio calado**, e zero divergência sobre zero linha é
 * indistinguível de "está tudo certo" — o modo de falha em que o gate fica verde
 * porque parou de medir. Por isso `conferirVacuidade` LANÇA, e é chamada tanto
 * pelo script quanto pelo teste: o instrumento tem de provar que estava vivo
 * antes de a ausência de achado valer alguma coisa.
 *
 * ## O que este parser deliberadamente NÃO faz
 *
 * Não exige que toda página do disco tenha linha no doc. O registro obrigatório
 * por tela já existe e é outro (`lib/navigation/registry.ts` +
 * `tests/unit/navegacao-completude.test.ts`, que reprova tela sem porta). Um
 * segundo espelho do disco, em tabela markdown lida por regex, seria a mesma
 * "segunda lista mantida à mão" que a derivação de `lib/audit/actions.ts`
 * acabou de matar — e o doc é um PLANO de 2026-04-28 (`version: 0.1`), não um
 * mapa do que existe.
 */

/** Uma linha numerada da tabela do inventário. */
export type LinhaDoInventario = {
  readonly numero: number;
  /** A letra da seção — `"M"`. */
  readonly secao: string;
  /** A rota como o doc a escreve — `"/admin/marca"`. */
  readonly rota: string;
  /** Valor da coluna `Prio` — `"P0"`, `"P1"`, `"P2"` ou `"**entregue**"`. */
  readonly prio: string;
  /** `true` quando a coluna `RT` começa com "sim". */
  readonly realtime: boolean;
};

/** Um cabeçalho de seção e o que ele promete. */
export type SecaoDoInventario = {
  readonly letra: string;
  readonly titulo: string;
  /** O número escrito no cabeçalho — `## M. … (18 telas)`. */
  readonly declarado: number;
  /** Quantas linhas numeradas a tabela de fato tem. */
  readonly contadas: number;
};

/** Os números globais que o doc afirma sobre si mesmo. */
export type TotaisDoInventario = {
  /** O total prometido na abertura, antes da primeira tabela. */
  readonly intro: number;
  readonly total: number;
  readonly p0: number;
  readonly p1: number;
  readonly p2: number;
  readonly entregues: number;
  readonly realtime: number;
  readonly crossTenant: number;
};

export type Inventario = {
  readonly secoes: readonly SecaoDoInventario[];
  readonly linhas: readonly LinhaDoInventario[];
  readonly totais: TotaisDoInventario;
  /** Rotas declaradas como planejadas e ainda não construídas. */
  readonly naoConstruido: readonly string[];
  /** Rotas do plano que existem, mas por um mecanismo que não é `page.tsx`. */
  readonly outroMecanismo: readonly string[];
  /** Quantas linhas o arquivo tem — entra no controle positivo. */
  readonly linhasDoArquivo: number;
};

/** Marcadores HTML — o parser não adivinha onde cada lista começa. */
const MARCADORES = {
  naoConstruido: "inventario:nao-construido",
  outroMecanismo: "inventario:outro-mecanismo",
} as const;

/**
 * Os rótulos do Resumo, e o que cada um deve bater.
 *
 * Rótulo ausente LANÇA em vez de virar zero: um Resumo reescrito sem o rótulo
 * faria a asserção comparar `0 === 0` e passar sobre nada.
 */
const ROTULOS = {
  total: "Total de telas únicas",
  p0: "P0",
  p1: "P1",
  p2: "P2",
  entregues: "Entregues",
  realtime: "Realtime obrigatório",
  crossTenant: "Cross-tenant (super-admin)",
} as const;

function numeroDoRotulo(texto: string, rotulo: string): number {
  // `- **P0** (semana 1–4): 41` — o rótulo em negrito, qualquer parêntese, e o
  // número depois do primeiro `:`.
  const escapado = rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^-\\s+\\*\\*${escapado}\\*\\*[^:\\n]*:\\s*(\\d+)\\b`, "m");
  const achado = re.exec(texto);
  if (!achado?.[1]) {
    throw new Error(
      `inventário: o Resumo não tem o rótulo "${rotulo}". O parser mede pelo rótulo; ` +
        `sem ele a comparação seria 0 === 0 e passaria sobre nada.`,
    );
  }
  return Number(achado[1]);
}

function listaEntreMarcadores(texto: string, marcador: string): string[] {
  const inicio = texto.indexOf(`<!-- ${marcador}:inicio -->`);
  const fim = texto.indexOf(`<!-- ${marcador}:fim -->`);
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error(
      `inventário: marcadores de "${marcador}" ausentes ou fora de ordem. ` +
        `Sem eles a lista é lida como vazia e a catraca deixa de vigiar.`,
    );
  }
  const bloco = texto.slice(inicio, fim);
  const rotas: string[] = [];
  for (const linha of bloco.split("\n")) {
    const achado = /^-\s+`(\/[^`]*)`/.exec(linha.trim());
    if (achado?.[1]) rotas.push(achado[1]);
  }
  return rotas;
}

/** Lê o markdown do inventário. Não toca no disco: recebe o texto. */
export function lerInventario(markdown: string): Inventario {
  const linhasDoArquivo = markdown.split("\n");
  const secoes: SecaoDoInventario[] = [];
  const linhas: LinhaDoInventario[] = [];

  let letraAtual = "";
  let colunas: string[] | null = null;
  let contadasNaSecao = 0;

  /**
   * Fecha a seção ABERTA — e só ela.
   *
   * A guarda por `letraAtual` não é zelo: o arquivo tem `##` depois da última
   * tabela (Resumo, Reconciliação). Sem ela, o segundo desses cabeçalhos
   * reescrevia a seção N com o contador já zerado, e a seção aparecia com 0
   * linhas. Medido aqui mesmo, na primeira execução do script.
   */
  const fecharSecao = () => {
    if (letraAtual === "") return;
    const ultima = secoes[secoes.length - 1];
    if (ultima) {
      secoes[secoes.length - 1] = { ...ultima, contadas: contadasNaSecao };
    }
    contadasNaSecao = 0;
  };

  for (const bruta of linhasDoArquivo) {
    const linha = bruta.trimEnd();

    const cabecalho = /^## ([A-Z])\.\s*(.+?)\((\d+) telas/.exec(linha);
    if (cabecalho?.[1] && cabecalho[2] && cabecalho[3]) {
      fecharSecao();
      letraAtual = cabecalho[1];
      colunas = null;
      secoes.push({
        letra: letraAtual,
        titulo: cabecalho[2].trim(),
        declarado: Number(cabecalho[3]),
        contadas: 0,
      });
      continue;
    }
    // Qualquer outro `##` encerra a seção corrente (Resumo, Reconciliação…).
    if (linha.startsWith("## ")) {
      fecharSecao();
      letraAtual = "";
      colunas = null;
      continue;
    }

    if (/^\|\s*#\s*\|/.test(linha)) {
      colunas = linha
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      continue;
    }

    const numerada = /^\|\s*(\d+)\s*\|/.exec(linha);
    if (!numerada?.[1] || !colunas || letraAtual === "") continue;

    const celulas = linha
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    const valor = (nome: string): string => {
      const i = colunas ? colunas.indexOf(nome) : -1;
      return i === -1 ? "" : (celulas[i] ?? "");
    };
    const caminho = valor("Path");
    const emCrase = /`([^`]+)`/.exec(caminho);
    linhas.push({
      numero: Number(numerada[1]),
      secao: letraAtual,
      rota: emCrase?.[1] ?? caminho,
      prio: valor("Prio"),
      realtime: valor("RT").startsWith("sim"),
    });
    contadasNaSecao += 1;
  }
  fecharSecao();

  const intro = /Total (\d+) telas/.exec(markdown);
  if (!intro?.[1]) {
    throw new Error(
      'inventário: a abertura não declara "Total N telas". O parser mede por essa frase.',
    );
  }

  return {
    secoes,
    linhas,
    totais: {
      intro: Number(intro[1]),
      total: numeroDoRotulo(markdown, ROTULOS.total),
      p0: numeroDoRotulo(markdown, ROTULOS.p0),
      p1: numeroDoRotulo(markdown, ROTULOS.p1),
      p2: numeroDoRotulo(markdown, ROTULOS.p2),
      entregues: numeroDoRotulo(markdown, ROTULOS.entregues),
      realtime: numeroDoRotulo(markdown, ROTULOS.realtime),
      crossTenant: numeroDoRotulo(markdown, ROTULOS.crossTenant),
    },
    naoConstruido: listaEntreMarcadores(markdown, MARCADORES.naoConstruido),
    outroMecanismo: listaEntreMarcadores(markdown, MARCADORES.outroMecanismo),
    linhasDoArquivo: linhasDoArquivo.length,
  };
}

/**
 * Compara rotas ignorando o NOME do segmento dinâmico.
 *
 * O doc escreve `/app/inbox/[conversationId]`; o disco tem `/app/inbox/[id]`.
 * São a mesma tela, e comparar cru produziria dezenas de divergências falsas
 * que afogariam as verdadeiras.
 */
export function normalizarRota(rota: string): string {
  return rota.replace(/\[[^\]]*\]/g, "[]");
}

/**
 * As rotas que existem no disco como `page.tsx`.
 *
 * Recebe o leitor de diretório em vez de importar `node:fs` — é o que permite
 * ao teste exercitar o walk sem tocar no disco, e o que mantém este módulo puro.
 */
export function rotasNoDisco(
  raiz: string,
  ler: (dir: string) => readonly { readonly nome: string; readonly diretorio: boolean }[],
  prefixo = "",
): string[] {
  const rotas: string[] = [];
  for (const entrada of ler(raiz)) {
    if (!entrada.diretorio) {
      if (entrada.nome === "page.tsx") rotas.push(prefixo === "" ? "/" : prefixo);
      continue;
    }
    // `(grupo)` é organização de arquivos, não segmento de URL. `_pasta` e
    // `@slot` não produzem rota.
    if (entrada.nome.startsWith("_") || entrada.nome.startsWith("@")) continue;
    const segmento = /^\(.*\)$/.test(entrada.nome) ? "" : `/${entrada.nome}`;
    rotas.push(...rotasNoDisco(`${raiz}/${entrada.nome}`, ler, `${prefixo}${segmento}`));
  }
  return rotas;
}

export type Reconciliacao = {
  /** Linhas do doc cuja rota não existe no disco como `page.tsx`. */
  readonly fantasmas: readonly LinhaDoInventario[];
  /** Páginas do disco sem linha no doc. Snapshot — NÃO é gate (ver cabeçalho). */
  readonly foraDoInventario: readonly string[];
  /** Rotas listadas como não construídas que JÁ existem: a catraca só encolhe. */
  readonly curadas: readonly string[];
  /** Fantasmas que ninguém declarou em nenhuma das duas listas. */
  readonly naoDeclarados: readonly LinhaDoInventario[];
  /** Rotas nas listas que não correspondem a nenhuma linha numerada. */
  readonly inventadas: readonly string[];
};

export function reconciliar(
  inventario: Inventario,
  rotasDoDisco: readonly string[],
): Reconciliacao {
  const disco = new Set(rotasDoDisco.map(normalizarRota));
  const doDoc = new Set(inventario.linhas.map((l) => normalizarRota(l.rota)));
  const declaradas = new Set(
    [...inventario.naoConstruido, ...inventario.outroMecanismo].map(normalizarRota),
  );

  const fantasmas = inventario.linhas.filter((l) => !disco.has(normalizarRota(l.rota)));

  return {
    fantasmas,
    foraDoInventario: rotasDoDisco.filter((r) => !doDoc.has(normalizarRota(r))).sort(),
    curadas: inventario.naoConstruido.filter((r) => disco.has(normalizarRota(r))).sort(),
    naoDeclarados: fantasmas.filter((l) => !declaradas.has(normalizarRota(l.rota))),
    inventadas: [...inventario.naoConstruido, ...inventario.outroMecanismo]
      .filter((r) => !doDoc.has(normalizarRota(r)))
      .sort(),
  };
}

/**
 * Controle positivo. LANÇA quando o instrumento não pode ter medido nada.
 *
 * Chamado pelo script E pelo teste, de propósito: sem isto, um parser quebrado
 * devolve zero divergência e as duas superfícies ficam verdes por terem parado
 * de olhar. `80` é folga sobre as 95 linhas medidas em 2026-08-14 — o número não
 * precisa acompanhar o inventário, só denunciar tabela que sumiu.
 */
export function conferirVacuidade(
  inventario: Inventario,
  rotasDoDisco: readonly string[],
): void {
  const problemas: string[] = [];
  if (inventario.linhas.length < 80) {
    problemas.push(`só ${inventario.linhas.length} linhas numeradas lidas do doc (esperado ≥80)`);
  }
  if (inventario.secoes.length < 10) {
    problemas.push(`só ${inventario.secoes.length} seções lidas (esperado ≥10)`);
  }
  if (rotasDoDisco.length < 20) {
    problemas.push(`só ${rotasDoDisco.length} páginas achadas no disco (esperado ≥20)`);
  }
  if (inventario.naoConstruido.length === 0) {
    problemas.push("a lista de não-construído veio vazia — a catraca não vigiaria nada");
  }
  if (inventario.outroMecanismo.length === 0) {
    problemas.push("a lista de outro-mecanismo veio vazia");
  }
  if (problemas.length > 0) {
    throw new Error(
      `inventário de telas: o instrumento não mediu nada.\n  - ${problemas.join("\n  - ")}`,
    );
  }
}
