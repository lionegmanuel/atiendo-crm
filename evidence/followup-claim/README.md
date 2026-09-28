# O claim do follow-up — as duas instabilidades, fechadas em 2026-08-30

Fecha `IA360-FLAKY` e `IA360-STARVATION`, os dois abertos **sem dono** por semanas. Os dois
já estavam consertados; o que faltava era a prova, e é ela que este documento guarda.

## Tipo de evidência — leia antes de regenerar

Seguindo [`evidence/README.md`](../README.md), este arquivo é **misto**, e a distinção não
é burocracia:

| Seção | Tipo | Por quê |
|---|---|---|
| A receita do instrumento (fim do arquivo) | **REPRODUZÍVEL** | `followup-engine.test.ts` continua no repo; o `head -339` deriva dele hoje e daqui a seis meses |
| Sabotagem do claim + previsão por nome | **REPRODUZÍVEL** | a forma antiga da função está em `supabase/baseline.sql:7414-7433`, preservada no dump |
| Lote abortado, curva de saturação, loads do momento | **HISTÓRICA** | aquela máquina sob load 158 não volta; o estado que produziu aquilo não existe mais |

> ⚠️ Se alguém regenerar a receita e sobrescrever o arquivo **inteiro**, a parte histórica
> morre junto sem deixar rastro. Não há `guardaEvidencia()` protegendo `.md` escrito à mão —
> a proteção do README cobre os PNGs gerados por script. Aqui a guarda é esta linha.

---

# Parte 1 — IA360-STARVATION

**O item afirmava:** o claim é global com limite 20, então organização com mais de 20
vencidos monopoliza cada tick e as menores nunca rodam. E `runFollowupTick` engolia a falha
do claim devolvendo `claimed=0`, indistinguível de "nada vencido".

**Os dois já estavam consertados:**

| O quê | Onde |
|---|---|
| Rodízio entre organizações | migration **0146** — `row_number()` por org, depois "posição 1 de todas as orgs, depois a 2 de todas". A forma anterior era `order by next_eval_at limit 20` **global** |
| Guarda do rodízio | `tests/invariants/followup-claim-justo.test.ts` (`49caf201`, 2026-08-10 15:18) — chama o adapter de **produção** (`createPgAdminClient`), não SQL reescrito para teste |
| `claimed=0` ambíguo | campo `claim_falhou` em `TickSummary` (`lib/followup/engine.ts:136`) + `logger.error` no catch; vigiado por `tests/unit/claim-falhou-nao-e-nada-vencido.test.ts` |

**A prova — sabotagem com a forma ORIGINAL.** Extraí `supabase/baseline.sql:7414-7433` (a
definição de antes da 0146, que continua no dump) e a reinstalei no banco de teste. Nada
redigitado: a variável do experimento foi a função, e só ela.

Previsão congelada **antes** de rodar — e prevendo **quais**, não quantos, porque
"2 falharam" não distingue a guarda que pega o defeito certo da que reprova por acaso:

| caso | previsto | medido |
|---|---|---|
| "organização com UM vencido é atendida no MESMO tick" | REPROVA | ❌ reprovou |
| "com UMA organização, o lote é os 20 mais antigos" | PASSA | ✅ passou |
| "o lease continua valendo" | PASSA | ✅ passou |
| "três organizações dividem o lote" | REPROVA | ❌ reprovou |

`Tests 2 failed | 2 passed (4)` — os quatro como previsto. Números brutos, que **são** o
defeito em aritmética:

```
expected [] to have a length of 1 but got +0        ← a org pequena recebeu ZERO
expected [ 21 ] to deeply equal [ 7, 7, 7 ]         ← uma levou 21, as outras nada
```

Os dois casos que **passam** são o controle: a forma antiga faz corretamente o lote único e
o lease. Se eles tivessem caído, a sabotagem teria alcançado além da variável e a medição
não valeria.

**NÃO MEDIDO — e o motivo não é falta de acesso, é falta de consequência.** O item usa
"baixo hoje (single-operator), grave em SaaS multi-tenant" para calibrar prioridade, e
saber se isso ainda vale exigiria consultar o banco de um cliente (contar `organizations`
com enrollment ativo nos últimos 30 dias e ver se há duas de tamanhos diferentes).

A medição foi **deliberadamente recusada**: gastar acesso a produção para descobrir se um
defeito **já consertado** seria urgente não altera nenhuma decisão. Registrado assim para
que ninguém leia esta lacuna como pendência — ela é uma escolha, e a escolha tem dono
(pedida ao Maestro antes de tocar em produção, e negada por este motivo).

---

# Parte 2 — IA360-FLAKY


> **Esta análise foi PRÉ-REGISTRADA.** O texto abaixo foi escrito com o resultado ainda
> vazio, em lacunas marcadas, e só depois preenchido com os números. Não é detalhe de
> processo: redigir depois deixa o desfecho moldar o argumento sem que o autor perceba —
> formular a hipótese após ver o número não parece desonestidade de dentro, parece clareza.
>
> **As duas regras usadas ao preencher**, registradas porque valem para o próximo:
>
> 1. **A lacuna recebe o NÚMERO BRUTO, nunca a leitura dele.** "reclamou 0" é dado; "a
>    corrida reproduziu" é interpretação, e interpretação dentro de lacuna é narrativa por
>    outra porta. Se a frase ao redor só faz sentido com um valor específico, ela já é
>    elástica — reescreva ANTES de medir.
> 2. **Se o resultado cair fora do previsto, NÃO apague a versão original.** Deixe a
>    previsão visível e escreva a leitura nova ao lado. Previsão errada é dado: diz o que a
>    casa acreditava e não era verdade. Análise que nunca erra é análise escrita depois.
>
> Neste caso nenhuma previsão divergiu, então não houve versão a preservar — e a cláusula
> que dizia "se qualquer linha divergir, a análise volta a ser hipótese" foi assinada antes
> de haver número, quando ainda custava alguma coisa assiná-la.
>
> Uma célula ficou **honestamente vazia** (o valor exato de `claimed` no caso ancorado, que
> o instrumento não captura). Tabela com célula vazia é mais confiável que tabela cheia: a
> cheia não deixa saber onde não olhar.

## O que o item afirmava

Invariante de follow-up instável no `test:db`, pintando o CI de vermelho aleatoriamente.
Caracterizado pelo Maestro sobre a base **`5e8a5478` (2026-08-04 19:21)**: 1 vermelho em 4
rodadas sem mudança de wave; a wave 4 viu **dois testes diferentes** caindo no mesmo SHA
(`followup-turn-bridge` e `followup-reactivity`), lido como assinatura de interferência de
estado.

## O que matou — nomeado, datado, e ancestral verificado

| SHA | Data | O que fez |
|---|---|---|
| `ff09f4b7` | 2026-08-10 13:43 | **Isolamento de fixture entre arquivos.** `fn_claim_due_followup_enrollments` é global por desenho e `tests/invariants/**` divide um Postgres não resetado entre arquivos (`fileParallelism: false`). Um enrollment devido deixado por um arquivo entrava no tick do seguinte e consumia vaga do lote. É a "interferência de estado" do item, palavra por palavra. |
| `552ef4b2` | 2026-08-10 17:47 | **Relógio ancorado no banco.** O engine grava `next_eval_at` com o relógio do PROCESSO; o claim lê com o `now()` do POSTGRES. Medido: 5 de 25 ticks reclamaram zero, e nos 5 o instante gravado era futuro para o banco por 7,1 a 13,2 ms. `relogioAncoradoNoBanco()` desloca o relógio de teste 250 ms para trás. |
| `c6bd41d5` | 2026-08-24 23:01 | **Guarda dedicada da janela anti-ban** — a que pega o defeito DE DIA. Outra família (gate lendo relógio de parede), citada aqui porque produz o mesmo sintoma e confundiria quem investigasse. |

`git merge-base --is-ancestor 5e8a5478 ff09f4b7` → **sim**. A caracterização é anterior aos
três consertos: o item descreve um mundo de seis dias antes do primeiro deles.

## O que NÃO entra neste fechamento

- **Os 8 pontos de produção** (5 em `node-handlers.ts`, 3 em `turn-bridge.ts`) que gravam
  `next_eval_at` pelo relógio do processo. É dependência latente de sincronia, tem dono
  próprio e custo calculado em zero com NTP (`teto(skew / 60s)`). Juntar faria este item
  fechado carregar dívida alheia.
- **`followup-intervencao.test.ts:229`**, que passaria mesmo com o claim engolido (só tem
  asserção negativa). Registrado à parte; não é causa da instabilidade.

## A prova de comportamento

Documento não é comportamento: commit prova que alguém escreveu, só a execução prova que
funciona. Duas medições, nesta ordem:

**1. Instrumento determinístico** (barato, não depende de carga): mesmo cenário do caso
`trigger → end leva 2 ticks`, variando só o relógio injetado. Previsão registrada
**antes** de rodar:

| condição | previsto (escrito em 2026-08-30, antes de medir) | medido | divergiu? |
|---|---|---|---|
| relógio adiantado (+5 s) | `tick2.claimed === 0` | **0** | não |
| relógio ancorado (−250 ms) | `tick2.claimed >= 1` | **≥ 1** ¹ | não |

O papel de cada linha, escrito antes e independente do valor que vier: a primeira
reproduz a corrida sob demanda; a segunda é o controle de vacuidade — sem ela, um motor
que nunca reclamasse nada satisfaria a primeira.

¹ O instrumento afirma o limiar, não captura o valor exato. É lacuna de instrumentação, não
resultado: se alguém precisar do número, imprima `t2.claimed` antes da asserção.

Medida direta do mecanismo, pelo próprio Postgres, no caso adiantado:
`next_eval_at está 4993.770ms no FUTURO para o banco` — adiantei 5000 ms e o banco viu
4993,77. A corrida não é folclore: é aritmética entre dois relógios, e reproduz sob demanda.

**2. Volume: NÃO FOI NECESSÁRIO.** O instrumento determinístico provou os dois lados, então
as dez rodadas — e os ~94 % que elas comprariam — deixaram de ser o caminho. A tabela da
régua abaixo fica como registro do que se faria se ele tivesse falhado.

**Se qualquer linha divergir**, a análise inteira acima ("o que matou") volta a ser
hipótese, e esta seção passa a registrar as duas versões — a prevista e a medida.

## A régua, declarada — e por que não é "dez rodadas verdes"

O `p` vem do **1 vermelho em 4 rodadas** registrado na própria caracterização, logo
`p ≈ 0,25`. A chance de N rodadas verdes serem sorte é `(1−p)^N`:

| rodadas | chance de ser sorte | confiança |
|---|---|---|
| 4 | 31,6 % | 68,4 % |
| 10 | 5,6 % | 94,4 % |
| 15 | 1,3 % | 98,7 % |
| 20 | 0,3 % | 99,7 % |

Dez não é número mágico: é ~94 %. Quem vier depois pode **discordar do `p`** — que é uma
premissa medida em 4 amostras, portanto frouxa — em vez de discordar do número. Número sem
premissa só pode ser aceito ou rejeitado; com premissa, pode ser refinado.

## Condições do ambiente

Registradas porque sem elas não se distingue "a causa morreu" de "o ambiente não a provocou
desta vez". Série amostrada de 30 em 30 s.

**Rodada que vale (2026-08-31 22:03 e 22:06 BRT), com a máquina liberada:**
load 15,9 → 18,1 → 9,1 em 11 núcleos (~1,5×, uso de mesa). Nenhum processo de vídeo, nenhum
outro container de teste. Duração do arquivo: 1,28 s (153 ms nos testes). É carga normal —
o timing reflete o que acontece no CI e na máquina de um cliente.

**Lote de 2026-08-30 21:28 abortado: ZERO rodadas úteis.** Load chegou a 158,42 em 11
núcleos (14×) com a rodada 1 em 26 min contra ~5 típicos, e sob essa saturação o
experimento deixa de medir a corrida de 7-13 ms e passa a medir a fila do escalonador —
verde ali diria "nada teve chance de correr em paralelo", que não é a pergunta. A máquina
estava renderizando vídeo do dono do produto.


## A RECEITA DO INSTRUMENTO — preservada porque o artefato se apaga

O executor instala em `tests/invariants/`, roda e **remove no `trap`**: instrumento de
medição não vira invariante (guarda permanente cobraria manutenção para vigiar um mundo que
só existe no CI). O preço é que a receita morre junto — então ela fica aqui, como bloco
literal, e não no repositório.

**Como reconstruir (2 passos):**

```bash
# 1. derive o setup do arquivo real — NÃO reescreva os helpers
head -339 tests/invariants/followup-engine.test.ts > /tmp/instrumento.test.ts
# 2. anexe o bloco abaixo, instale, rode SÓ ele, remova
cp /tmp/instrumento.test.ts tests/invariants/zzz-instrumento.test.ts
trap 'rm -f tests/invariants/zzz-instrumento.test.ts' EXIT
PATH="$PWD/node_modules/.bin:$PATH" bash scripts/test-db.sh --reporter=verbose \
  tests/invariants/zzz-instrumento.test.ts 2>&1        # verbose e SEM tail
```

O `head -339` é a fronteira antes do primeiro `describe` — derivar em vez de copiar é o que
faz o instrumento medir **o que o arquivo real faz**, e não a minha leitura dele.
`--reporter=verbose` e ausência de `tail` não são zelo: sem eles você tem a contagem
("2 passed") e não o dado (quais dois, e o `console.log` do skew).

**O bloco a anexar:**

```ts

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENTO DESCARTÁVEL — não commitar. Roda, prova, morre.
//
// Pergunta: a corrida entre o relógio do PROCESSO e o do POSTGRES ainda existe,
// e é a ancoragem (`relogioAncoradoNoBanco`) que a segura?
//
// O cenário é o mesmo do caso "trigger → end leva 2 ticks" acima — o tick 1
// grava `next_eval_at = clock()` e o tick 2 tenta reclamar com
// `next_eval_at <= now()` do banco. A ÚNICA variável entre os dois casos é o
// relógio injetado. Nada de latência artificial no db: adiantar o relógio
// produz o mesmo efeito que 7-13ms de desvio, só que com 5 SEGUNDOS de margem,
// o que torna determinístico o que era probabilístico.
//
// Esperado:
//   relógio ADIANTADO (+5s)  -> tick 2 reclama 0   (a corrida, sob demanda)
//   relógio ANCORADO (-250ms)-> tick 2 reclama >=1 (o conserto segurando)
//
// O segundo caso é o controle de vacuidade: sem ele, um motor que nunca
// reclamasse nada também satisfaria o primeiro.
// ─────────────────────────────────────────────────────────────────────────────

function depsComRelogio(jobs: FollowupJobRequest[], clock: () => Date): TickDeps {
  return { db: pgAdminClient(), clock, enqueueJob: async (job) => void jobs.push(job) };
}

async function cenarioDeDoisTicks(org: string): Promise<string> {
  await seedOrg(org);
  const contactId = await seedContact(org);
  const { pointerId, versionId } = await seedFlow(org, TWO_NODE_GRAPH);
  return seedEnrollment({ org, pointerId, versionId, contactId, currentNodeId: "t1" });
}

describe("INSTRUMENTO — a corrida dos dois relógios, sob demanda", () => {
  it("relógio ADIANTADO: o tick 2 reclama ZERO — a corrida reproduzida deterministicamente", async () => {
    const org = "bbbbbbb1-0000-4000-8000-000000000001";
    const enrollmentId = await cenarioDeDoisTicks(org);
    const adiantado = (): Date => new Date(Date.now() + 5000);

    const jobs: FollowupJobRequest[] = [];
    const t1 = await runFollowupTick(depsComRelogio(jobs, adiantado), { limit: 5 });
    expect(t1.claimed, "o tick 1 reclama normalmente: o enrollment já nascia devido").toBe(1);
    expect(t1.advanced).toBe(1);

    const depoisDoT1 = await getEnrollment(enrollmentId);
    const skew = await pool.query<{ futuro_ms: string }>(
      `select extract(milliseconds from (next_eval_at - now())) as futuro_ms
         from followup_enrollments where id = $1`,
      [enrollmentId],
    );
    // eslint-disable-next-line no-console
    console.log(
      `[instrumento] adiantado: next_eval_at está ${skew.rows[0]?.futuro_ms}ms no FUTURO para o banco`,
    );
    expect(depoisDoT1.current_node_id).toBe("e1");

    const t2 = await runFollowupTick(depsComRelogio(jobs, adiantado), { limit: 5 });
    expect(t2.claimed, "com o relógio adiantado o instante gravado é futuro: o claim não pega").toBe(0);
  });

  it("relógio ANCORADO: o tick 2 reclama — é a âncora que segura (controle de vacuidade)", async () => {
    const org = "bbbbbbb2-0000-4000-8000-000000000002";
    const enrollmentId = await cenarioDeDoisTicks(org);

    const jobs: FollowupJobRequest[] = [];
    const t1 = await runFollowupTick(depsComRelogio(jobs, relogioAncoradoNoBanco()), { limit: 5 });
    expect(t1.claimed).toBe(1);

    const t2 = await runFollowupTick(depsComRelogio(jobs, relogioAncoradoNoBanco()), { limit: 5 });
    expect(t2.claimed, "ancorado atrás do banco, o instante já passou: o claim pega").toBeGreaterThanOrEqual(1);

    const fim = await getEnrollment(enrollmentId);
    expect(fim.status).toBe("completed");
  });
});
```
