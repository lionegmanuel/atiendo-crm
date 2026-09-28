import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Database } from "@/lib/database.types";

/**
 * O TÍTULO DO EVENTO PESSOAL NÃO ATRAVESSA PARA A TELA DO CRM.
 *
 * ─── Por que isto é um gate e não um comentário ──────────────────────────────
 * A decisão de mostrar a ocupação do Google SEM o nome do evento é deliberada, e
 * um comentário sozinho não a protege: quem chega depois lê a ausência do título
 * como esquecimento e o acrescenta achando que está melhorando a tela. Nesta
 * base a regra é conhecida — mecanismo protege, prosa é intenção.
 *
 * ─── A decisão, e ela é medida ───────────────────────────────────────────────
 * `calendar_external_events.title` EXISTE, e guarda nome em linhas gravadas antes
 * da v1.17.0 (desde a migration 0225 o sincronizador grava o título nulo e zera
 * o que encontra). O que não pode é chegar à tela: a agenda conectada é PESSOAL de quem atende e a tela da Agenda
 * é multi-tenant, vista por gestor. "Consulta médica", "terapia", "entrevista de
 * emprego" apareceriam para o chefe.
 *
 * O cal.com decidiu o mesmo, e a prova de que é decisão e não limitação é que
 * eles gravam `summary`/`description`/`location` no cache e o `select` da
 * leitura devolve só `start`/`end`/`timeZone`. Guardar e não ler é intenção.
 *
 * E o nosso caso é pior que o deles: no cal.com a tela é do próprio dono da
 * agenda; aqui, não.
 *
 * ─── O que este gate NÃO proíbe ──────────────────────────────────────────────
 * Ler `title` no SERVIDOR para outra finalidade — um relatório do próprio dono
 * da agenda, um export de LGPD para o titular — não é o que está em jogo. O que
 * se guarda é a travessia para a TELA da Agenda, que é onde a exposição
 * acontece. Por isso o recorte não é o repo inteiro — mas ele também não é uma
 * pasta só.
 *
 * ⚠️ O RECORTE PRECISOU CRESCER, e o motivo foi MEDIDO — não é zelo.
 *
 * Ele era `app/app/agenda/**` e mais nada. Isso bastava enquanto a ocupação
 * chegava à tela por UM caminho: a semente que o servidor monta em `page.tsx`.
 * O PR #474 (@Clalber) acrescentou o segundo — a rota
 * `app/api/v1/agenda/agendamentos`, que substitui a semente no primeiro
 * refetch e serve TODA navegação depois dele.
 *
 * A guarda ficou cega para o caminho novo. Medido na triagem do #474, a mesma
 * sabotagem (`title` acrescentado ao `select`) nos dois lados:
 *
 *   em `app/app/agenda/page.tsx`                 → exit 1  (a guarda pega)
 *   em `app/api/v1/agenda/agendamentos/route.ts` → exit 0  (a guarda passa)
 *
 * O recorte de uma guarda de privacidade não é a PASTA onde a tela mora: é o
 * conjunto de caminhos por onde o dado chega até ela. Caminho novo entra aqui
 * — senão a guarda segue verde afirmando o que deixou de medir, que é o pior
 * desfecho para uma guarda de ausência.
 *
 * ⚠️ E O NOME DA RELAÇÃO É CAMINHO TAMBÉM — a mesma cegueira, uma segunda vez.
 *
 * O PR #613 (d69d708d8) trocou as duas leituras de `calendar_external_events`
 * pela view `calendar_selected_external_events`, e a regex seguia casando só o
 * nome da tabela. Medido na triagem do #897, com `title` acrescentado ao
 * `select` de `page.tsx` e de `agendamentos/route.ts`: **3 passed (3)**. O
 * controle de vacuidade também ficava verde, satisfeito pelo `.delete()` de
 * `google/desconectar/route.ts` — uma consulta que não seleciona nada. Por
 * isso a regex casa a tabela E a view, e o controle cobra uma leitura COM
 * `select` em cada caminho, não "alguma consulta em algum lugar".
 *
 * ⚠️ E O LUGAR DA LEITURA MUDOU — a mesma cegueira, uma TERCEIRA vez.
 *
 * O PR #915 (f8481845f, @webtecnica) tirou as duas consultas de dentro das
 * pastas de tela e as juntou num módulo só — `lib/agenda/ocupacao-externa.ts` —
 * para a semente e a rota pararem de divergir (issue #525). O recorte daqui
 * seguia sendo as duas PASTAS, então a varredura deixou de achar consulta
 * nenhuma, e o caso "nenhuma delas pede `title`" passou a ficar verde por
 * VACUIDADE — exatamente o desfecho que o controle existe para negar. Medido na
 * integração do lote 12 (778d1dcb2): `Tests 2 failed | 9 passed`, com o
 * controle acusando `["app/app/agenda", "app/api/v1/agenda"]` sem leitura.
 *
 * Antes de seguir a consulta, a pergunta na ordem certa — a privacidade
 * continua valendo no caminho novo? Continua, e por três medidas: o `select` do
 * módulo é `"id, starts_at, ends_at, calendar_connections!inner(user_id)"`;
 * `grep -c '\btitle\b' lib/agenda/ocupacao-externa.ts` devolve `0`; e o tipo
 * devolvido (`BlocoExternoDaTela`) não tem campo de título, com os dois
 * consumidores cravando `titulo: "Ocupado"`. A decisão não foi desfeita — ela
 * mudou de endereço, e o gate é que a seguiu.
 *
 * ⚠️ E O ENDEREÇO MUDOU PELA QUARTA VEZ — a mesma cegueira, o mesmo conserto.
 *
 * O #896 (42c55839) tirou a consulta direta de `lib/agenda/ocupacao-externa.ts`:
 * para o Atendente ver a ocupação do Google de quem é dono da agenda, a leitura
 * passou a ser `fn_agenda_ocupacao_google_do_dono` (migration 0260,
 * `security definer`), que confere o pertencimento e devolve só ocupação. O
 * controle de vacuidade reprovou no CI do #1107, como devia — a varredura
 * inteira achou `[]`.
 *
 * A decisão não mudou: mudou de endereço, e este arquivo seguiu. O controle
 * agora cobra a CHAMADA da função, e a ausência de `title` no caminho novo está
 * presa no TIPO do retorno dela (o caso "o retorno da função não oferece
 * `title`"), com o lado do banco em
 * `tests/invariants/titulo-do-evento-pessoal-fora-do-alcance.test.ts`.
 *
 * Se um dia a decisão mudar, o caminho é POR ORGANIZAÇÃO e com aviso de quem vê
 * — nunca por default. Quem for fazer isso troca este teste junto, de propósito:
 * é o passo que obriga a decisão a ser tomada por gente.
 */
const RAIZ = process.cwd();

/**
 * Onde a leitura da ocupação MORA hoje (PR #915). É o alvo principal do gate: o
 * controle de vacuidade cobra a consulta AQUI, para que mover a leitura de novo
 * reprove em vez de deixar a varredura medindo o vazio.
 */
const DONO_DA_LEITURA = path.join(RAIZ, "lib", "agenda", "ocupacao-externa.ts");

/**
 * Os caminhos por onde a ocupação do Google pode chegar à tela da Agenda.
 *
 * Os três são superfície de exposição por razões diferentes: o primeiro é o
 * módulo onde a consulta mora; o segundo é a semente que o servidor renderiza;
 * o terceiro é a rota que a substitui no primeiro refetch.
 *
 * As duas pastas de tela seguem varridas mesmo sem consulta própria desde o
 * #915: elas são onde uma consulta RE-INLINADA nasceria, e uma guarda de
 * privacidade não deve depender de outro gate estar verde para enxergar o que
 * aparecer ali. Que não exista uma terceira cópia em nenhum outro lugar de
 * `app/` ou `lib/agenda/` é o que `ocupacao-do-google-vem-de-um-lugar-so.test.ts`
 * mede, varrendo `git ls-files`.
 */
const CAMINHOS_ATE_A_TELA = [
  DONO_DA_LEITURA,
  path.join(RAIZ, "app", "app", "agenda"),
  path.join(RAIZ, "app", "api", "v1", "agenda"),
];

function arquivos(alvo: string): string[] {
  if (!fs.existsSync(alvo)) return [];
  // O alcance tem pasta E arquivo: desde o #915 a consulta mora num módulo só,
  // e apontar o recorte para o diretório inteiro de `lib/agenda/` traria uma
  // dúzia de arquivos que não têm nada com a travessia para a tela.
  if (fs.statSync(alvo).isFile()) return /\.tsx?$/.test(alvo) ? [alvo] : [];
  return fs.readdirSync(alvo, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(alvo, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.isFile() && /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Apaga o conteúdo de linhas que são só comentário, preservando as quebras. */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? "" : l))
    .join("\n");
}

/**
 * A tabela do espelho e a view de ocupação que a lê. As duas carregam — ou
 * carregaram — o `title`; a leitura da tela passa pela view.
 */
const RELACOES_DO_ESPELHO = /\.from\("calendar_(?:selected_)?external_events"\)([\s\S]*?);/g;

/**
 * O endereço da leitura desde o #896 (42c55839): a ocupação chega pela função
 * `security definer`, que confere o pertencimento do dono e devolve só ocupação.
 *
 * É esta chamada que o controle de vacuidade cobra agora. As consultas diretas
 * às duas relações seguem varridas por `RELACOES_DO_ESPELHO`: se alguém
 * re-inlinear uma leitura nas telas, o caso "nenhuma delas pede `title`" a
 * enxerga de novo em vez de medir o vazio.
 */
const CHAMADA_DA_FUNCAO_DO_DONO = /\.rpc\(\s*"fn_agenda_ocupacao_google_do_dono"/;

/**
 * ⚠️ O QUE PRENDE A PRIVACIDADE NO CAMINHO DA RPC — e por que faltava.
 *
 * Com a leitura por `.rpc(...)`, o caso "nenhuma delas pede a coluna `title`"
 * ficou sem nada para medir: a varredura de `.from(...)` acha, nos três
 * caminhos, só o `.delete()` de `google/desconectar/route.ts` — que não
 * seleciona coluna nenhuma e por isso é descartado pelo filtro. O que sobrava
 * era a asserção de TIPO, e ela não cobre este furo por dois motivos somados:
 * `expectTypeOf` é no-op em tempo de execução (só o `pnpm typecheck` a mede) e
 * o que ela inspeciona é o tipo GERADO (`Database[...]["Returns"]`), não a
 * interface que o módulo escreve à mão para ler a resposta.
 *
 * Medido neste worktree, no head do #1107, com `title` acrescentado à linha da
 * RPC (`LinhaDaOcupacaoDoGoogle`) E devolvido à tela (`BlocoExternoDaTela`):
 * `Tests 4 passed (4)`. A exposição inteira passava com o gate verde — que é o
 * pior desfecho para uma guarda de ausência, e a quinta vez que esta guarda
 * cega pela mudança de endereço.
 *
 * Os dois casos abaixo prendem as DUAS metades da decisão, uma cada:
 * não PEDIR conteúdo (o nome da coluna não aparece no módulo) e não DEVOLVER
 * conteúdo (o bloco entregue à tela só declara quando e de quem).
 */

/**
 * Os nomes por onde um campo de CONTEÚDO do evento entraria no módulo.
 *
 * `title` é a única coluna de conteúdo que o espelho tem hoje
 * (`calendar_external_events.title`). Os outros três são como a API do Google
 * chama o mesmo dado — entram porque é por esses nomes que uma coleta nova
 * pediria o conteúdo, possivelmente antes de existir coluna com esse nome do
 * nosso lado. Nenhum dos quatro aparece no módulo hoje, nem em comentário:
 * `grep -cE '\b(title|summary|description|location)\b' lib/agenda/ocupacao-externa.ts`
 * devolve `0`.
 */
const CAMPOS_DE_CONTEUDO_DO_EVENTO = /\b(?:title|summary|description|location)\b/g;

/**
 * O que o bloco entregue à tela pode declarar: QUANDO e DE QUEM, nunca O QUÊ.
 *
 * `id` está aqui porque é DERIVADO (`dono:início:fim`) — a função não devolve o
 * id do compromisso. Campo novo nesta lista é decisão de produto: é o ponto
 * onde alguém teria de escrever, de propósito, que a tela passou a carregar
 * mais do que a fatia de tempo.
 */
const CAMPOS_DO_BLOCO_DA_TELA = ["id", "donoId", "iniciaEm", "terminaEm"];

/** A interface que o módulo entrega a quem desenha, sem os comentários. */
const DECLARACAO_DO_BLOCO = /export interface BlocoExternoDaTela \{([\s\S]*?)\n\}/;

/**
 * As consultas à tabela do espelho e à view de ocupação feitas nos caminhos até
 * a tela da Agenda, com o caminho de origem e as colunas que cada uma pede
 * (vazio quando a cadeia não tem `.select`, como num `.delete()`).
 */
function consultasDeEventoExterno(): Array<{ caminho: string; onde: string; colunas: string | null }> {
  const out: Array<{ caminho: string; onde: string; colunas: string | null }> = [];
  for (const caminho of CAMINHOS_ATE_A_TELA) {
    for (const arquivo of arquivos(caminho)) {
      const fonte = semComentarios(fs.readFileSync(arquivo, "utf8"));
      const rel = path.relative(RAIZ, arquivo);
      for (const m of fonte.matchAll(RELACOES_DO_ESPELHO)) {
        const cadeia = m[1] ?? "";
        const sel = /\.select\(\s*"([^"]*)"/.exec(cadeia);
        out.push({
          caminho: path.relative(RAIZ, caminho),
          onde: `${rel}:${fonte.slice(0, m.index ?? 0).split("\n").length}`,
          colunas: sel?.[1] ?? null,
        });
      }
    }
  }
  return out;
}

describe("a ocupação do Google não leva o nome do evento para a tela", () => {
  it("o DONO da leitura busca a ocupação pela função do dono (senão o gate mede o vazio)", () => {
    // Controle do instrumento. Sem isto, mover a consulta, renomear o
    // diretório ou trocar a relação lida deixaria o gate verde por não medir
    // nada — e ele afirmaria o que não mediu, que é o pior desfecho para uma
    // guarda de privacidade.
    //
    // ⚠️ QUARTA VEZ que o endereço da leitura muda, e a quarta vez que o
    // controle fez o trabalho dele: medido no CI do #1107, a varredura inteira
    // achou `[]` e a mensagem foi `nenhuma leitura de
    // calendar_external_events ... em lib/agenda/ocupacao-externa.ts`. O #896
    // (42c55839) tirou a consulta direta dali: para o Atendente ver a ocupação
    // da dona, a leitura passou a ser `fn_agenda_ocupacao_google_do_dono`
    // (migration 0260, `security definer`), que confere o pertencimento e
    // devolve só ocupação.
    //
    // A decisão de privacidade continua valendo no endereço novo, e por duas
    // medidas: a função não devolve `title` — o contrato está preso no TIPO, no
    // caso logo abaixo —, e o lado do banco é vigiado por
    // `tests/invariants/titulo-do-evento-pessoal-fora-do-alcance.test.ts`.
    const fonte = semComentarios(fs.readFileSync(DONO_DA_LEITURA, "utf8"));
    const dono = path.relative(RAIZ, DONO_DA_LEITURA);

    expect(
      CHAMADA_DA_FUNCAO_DO_DONO.test(fonte),
      `nenhuma chamada a \`fn_agenda_ocupacao_google_do_dono\` em ${dono} — ou a ocupação ` +
        `deixou de ser buscada, ou ela mudou de endereço de novo e este gate ficou cego.`,
    ).toBe(true);
  });

  it("o dono da leitura não NOMEIA campo de conteúdo do evento (não pedir)", () => {
    // A metade "não pedir" da decisão, medida no código que roda — não no tipo.
    // Uma coluna não se lê sem nomeá-la: `linha.title`, `p_campos: "title"`,
    // `select("title")`, tudo passa por escrever a palavra. O módulo trata só
    // de OCUPAÇÃO do Google, então nenhum desses nomes tem ali uso legítimo, e
    // é isso que faz esta varredura ser possível sem allowlist.
    const fonte = semComentarios(fs.readFileSync(DONO_DA_LEITURA, "utf8"));
    const dono = path.relative(RAIZ, DONO_DA_LEITURA);

    const achados = [...fonte.matchAll(CAMPOS_DE_CONTEUDO_DO_EVENTO)].map(
      (m) => `${dono}:${fonte.slice(0, m.index ?? 0).split("\n").length} → ${m[0]}`,
    );

    expect(
      achados,
      `${dono} passou a nomear um campo de CONTEÚDO do evento externo. A agenda conectada é ` +
        "PESSOAL de quem atende e a tela da Agenda é multi-tenant, vista por gestor: 'consulta " +
        "médica', 'terapia', 'entrevista' apareceriam para o chefe. A função " +
        "`fn_agenda_ocupacao_google_do_dono` devolve ocupação (início, fim, transparência, " +
        "situação) de propósito — nem `id`, nem título. Se a decisão mudou, ela é POR " +
        "ORGANIZAÇÃO e com aviso de quem vê, e este teste muda junto, para a decisão ser " +
        "tomada por gente.",
    ).toEqual([]);
  });

  it("o bloco entregue à tela declara só QUANDO e DE QUEM (não devolver)", () => {
    // A metade "não devolver": barrar o nome da coluna não basta, porque o
    // conteúdo pode chegar renomeado na travessia (`titulo: linha[coluna]`). O
    // que a tela recebe é esta interface, e ela é a fronteira — por isso o que
    // se mede aqui é a LISTA de campos, não a ausência de um nome.
    const fonte = semComentarios(fs.readFileSync(DONO_DA_LEITURA, "utf8"));
    const dono = path.relative(RAIZ, DONO_DA_LEITURA);
    const corpo = DECLARACAO_DO_BLOCO.exec(fonte)?.[1];

    // Controle do instrumento: interface renomeada ou movida deixaria a
    // varredura medindo o vazio e o gate verde sem ter olhado.
    expect(
      corpo,
      `não achei \`export interface BlocoExternoDaTela\` em ${dono} — o bloco entregue à tela ` +
        "mudou de nome ou de arquivo, e este gate ficou cego.",
    ).toBeTypeOf("string");

    // `?? ""` porque `noUncheckedIndexedAccess` tipa o grupo como
    // `string | undefined`, e um campo sem nome não existe: grupo vazio cairia
    // fora da allowlist e reprovaria com uma mensagem que não explica nada.
    const campos = [...(corpo ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "");
    expect(campos.length, `nenhum campo lido de \`BlocoExternoDaTela\` em ${dono}`).toBeGreaterThan(0);

    expect(
      campos.filter((campo) => !CAMPOS_DO_BLOCO_DA_TELA.includes(campo)),
      `\`BlocoExternoDaTela\` ganhou campo fora de ${JSON.stringify(CAMPOS_DO_BLOCO_DA_TELA)}. ` +
        "O bloco descreve QUANDO o horário está tomado e DE QUEM é a agenda — nunca O QUÊ está " +
        "marcado. Campo de conteúdo (título, descrição, local, convidados) atravessando aqui é a " +
        "exposição que este arquivo inteiro existe para impedir. Campo novo de FORMA (dia " +
        "inteiro, fuso) é legítimo: acrescente-o à lista acima, e a revisão passa a ver a " +
        "decisão.",
    ).toEqual([]);
  });

  it("o retorno da função não oferece `title` — o contrato do banco preso no tipo", () => {
    // A asserção de privacidade que sobrevive à mudança de endereço: a função
    // devolve cinco colunas — início, fim, transparência, status e o status da
    // conexão — e nenhuma delas é o nome do compromisso. Roda no
    // `pnpm typecheck` (`tsconfig.typecheck.json` inclui `tests/**`), o mesmo
    // passo que prende o tipo da view em `view-de-ocupacao-nao-tipa-o-titulo`.
    type RetornoDaFuncao =
      Database["public"]["Functions"]["fn_agenda_ocupacao_google_do_dono"]["Returns"][number];

    expectTypeOf<RetornoDaFuncao>().not.toHaveProperty("title");
    // Controle: o tipo não virou vazio — a linha acima passaria por acidente.
    expectTypeOf<RetornoDaFuncao>().toHaveProperty("starts_at").toEqualTypeOf<string>();
    expectTypeOf<RetornoDaFuncao>().toHaveProperty("transparency").toEqualTypeOf<string>();
  });

  it("nenhuma delas pede a coluna `title`", () => {
    const comTitulo = consultasDeEventoExterno()
      .filter((c) => c.colunas !== null && /\btitle\b/.test(c.colunas))
      .map((c) => `${c.onde} → select("${c.colunas}")`);

    expect(
      comTitulo,
      "A tela da Agenda passou a pedir o `title` do evento externo. A agenda conectada é " +
        "PESSOAL de quem atende e esta tela é multi-tenant, vista por gestor: o nome de um " +
        "compromisso particular — 'consulta médica', 'terapia', 'entrevista' — apareceria " +
        "para o chefe. A coluna existe e guarda nome de sincronizações antigas; o que não pode é ela atravessar " +
        "para cá. Se a decisão mudou, ela é POR ORGANIZAÇÃO e com aviso de quem vê, e este " +
        "teste muda junto — de propósito, para a decisão ser tomada por gente.",
    ).toEqual([]);
  });

  it("a sonda enxerga o `title` quando ele aparece — controle positivo", () => {
    // Sem este caso, um regex quebrado devolveria lista vazia para sempre e o
    // gate diria "nenhuma expõe" sem ter olhado. É o modo de falha que uma
    // guarda de ausência esconde melhor.
    const padrao = /\btitle\b/;
    expect(padrao.test("id, starts_at, ends_at, status")).toBe(false);
    expect(padrao.test("id, title, starts_at")).toBe(true);
    // E a relação: a leitura da tela passa pela VIEW. Uma regex que casasse só
    // a tabela devolveria vazio para as duas leituras reais.
    for (const relacao of ["calendar_external_events", "calendar_selected_external_events"]) {
      expect([...`.from("${relacao}").select("id");`.matchAll(RELACOES_DO_ESPELHO)]).toHaveLength(1);
    }

    // E as duas sondas do caminho da RPC, pelo mesmo motivo: elas afirmam
    // AUSÊNCIA, e uma regex quebrada afirmaria a ausência sem ter olhado.
    expect("  starts_at: string;".match(CAMPOS_DE_CONTEUDO_DO_EVENTO)).toBeNull();
    expect("  titulo: linha.title ?? null,".match(CAMPOS_DE_CONTEUDO_DO_EVENTO)).toEqual(["title"]);
    // `\b` não pode deixar passar o nome dentro de outro identificador.
    expect("  const tituloDoEvento = 1;".match(CAMPOS_DE_CONTEUDO_DO_EVENTO)).toBeNull();

    const corpoFalso = DECLARACAO_DO_BLOCO.exec(
      'export interface BlocoExternoDaTela {\n  id: string;\n  titulo?: string | null;\n}\n',
    )?.[1];
    expect([...(corpoFalso ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "")).toEqual([
      "id",
      "titulo",
    ]);
  });
});
