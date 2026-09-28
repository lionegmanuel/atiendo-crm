# HANDOFF — Índice de Atrito (spec 17)

> **Leia este arquivo no início de qualquer sessão que continue este trabalho.**
> Alimente-o a cada avanço: o que foi feito, o que foi **provado** (com evidência
> observada), bug encontrado, e o que ficou pendente. Progresso sem prova não
> entra aqui.

| | |
|---|---|
| **Branch** | `feat/indice-de-atrito` (empilhada sobre `docs/doutrina-sistema-vivo-manual`) |
| **Spec** | [`docs/specs/17-spec-indice-de-atrito.md`](../specs/17-spec-indice-de-atrito.md) |
| **Doutrina** | [`docs/doctrine/sistema-vivo/03-medida-do-proposito.md`](../doctrine/sistema-vivo/03-medida-do-proposito.md) |
| **Fase** | 4 de 4 — TODAS provadas, inclusive na tela |
| **Gate de banco** | `pnpm test:db` **verde**: 73 arquivos · 503 passed · 1 skipped · `install ok` + `update ok` |
| **E2E** | **20 passed / 0 failed** nas 8 specs da parte 1 do CI que tocam este trabalho (inclui `inbox-scope`, `risk-radar`, `queue-assign`, `rbac-roles`) |
| **Atualizado** | 2026-08-07 |

> ⚠️ **Se o `test:db` falhar com ~10 testes, meça o TEMPO antes de investigar.**
> Rodei duas vezes no mesmo commit: com a máquina saturada (Docker recém-reiniciado
> + Supabase local no ar) deu **10 failed em 2632s**; com a máquina livre
> (`npx supabase stop`), **0 failed em 136s** — 20× mais rápido. Nove das dez
> falhas eram `Test timed out in 30000ms`, e as vítimas eram sorteadas
> (`webhooks-inbound`, `automation-*`, `event-log-drain`, `rls-isolation`).
> Chegaram a incluir o **controle positivo** do isolamento RLS, o que dá toda a
> aparência de defeito grave de tenancy — e não era.

> ⚠️ **Reconstruir o ambiente local de e2e — a receita, e as três armadilhas.**
> O caminho é o do `.github/workflows/e2e.yml`, não o `npx supabase start` puro
> (a cadeia de `migrations/` **não sobe** em banco novo):
>
> ```bash
> mv supabase/migrations /tmp/mig-off && mkdir -p supabase/migrations
> npx supabase start --ignore-health-check     # o container de storage não fica healthy
> rmdir supabase/migrations && mv /tmp/mig-off supabase/migrations
> # extensões (o baseline USA os tipos e não os cria), depois o baseline, depois:
> npx tsx scripts/seed-e2e-credentials.ts
> npx tsx scripts/seed-e2e-escalacao.ts
> npx tsx --env-file=.env.local scripts/seed-e2e-capacidades-ausentes.ts
> npx tsx scripts/seed-e2e-followup-agent.ts
> npx tsx scripts/seed-e2e-queue.ts            # NÃO está na lista do CI, e o
>                                              # queue-assign.spec exige
> ```
>
> 1. **`seed-e2e-escalacao.ts` lê o `.env.local` por conta própria.** Se ele
>    apontar para a nuvem, o seed escreve fixture no banco REMOTO. Aponte o
>    `.env.local` para `127.0.0.1:54321` antes — e confira que nenhuma linha
>    **não-comentada** ainda tem `supabase.co`.
> 2. **Rodar `seed-e2e-credentials.ts` duas vezes dessincroniza o TOTP:** o
>    arquivo fica com um segredo e `auth.mfa_factors` com outro, e o
>    `rbac-roles.spec` falha no MFA parecendo bug de autenticação. Conserto:
>    copiar `select secret from auth.mfa_factors` para o `.e2e-creds.json`.
> 3. **`npx playwright install chromium`** — o config usa `chrome-headless-shell`,
>    um binário diferente do que `chromium.launch()` das sondas usa. Sem ele, as
>    9 specs falham todas com "Executable doesn't exist", que não se parece com
>    problema de browser à primeira vista.
>
> Duas falhas que apareceram e sumiram na repetição (`inbox-scope` deep-link e
> `queue-assign`) eram **flaky**, não regressão: passaram na segunda execução com
> o mesmo binário e o mesmo commit.

---

## Por que este trabalho existe

O sistema media `won`, `lost`, `conversations_handled`, `avg_first_response_seconds`
— atividade e conversão. O propósito declarado é **"menor atrito possível para os
dois lados"** e não tinha número nenhum.

Consequência concreta, não hipotética: **um agente que insiste seis vezes converte
mais e queima relacionamento — e nos painéis atuais aparece como o melhor da
organização.** `agent_cases.followup_attempts` já contava a insistência e nenhuma
tela lia a coluna.

---

## Estado atual

### ✅ Feito e PROVADO

| Peça | Arquivo | Prova observada |
|---|---|---|
| Migration 0133 | `supabase/migrations/20260806190000_0133_fn_atrito_metrics.sql` | `pnpm test:db` verde — baseline aplicado em **install** e **update** |
| Apêndice do baseline | `supabase/baseline.sql` (fim do arquivo) | idem — é o que o self-hoster aplica |
| Linha no MANIFEST | `supabase/migrations/MANIFEST.md` | — |
| Módulo de pares | `lib/metrics/atrito.ts` | 26 testes unitários verdes |
| Teste unitário (gate da regra 3.3) | `tests/unit/atrito-par-eficiencia-dano.test.ts` | 26/26 · **2 sabotagens confirmadas** |
| Invariante de banco | `tests/invariants/atrito-metrics.test.ts` | 11/11 contra Postgres real · **1 sabotagem confirmada** |
| Rota | `app/api/v1/metrics/atrito/route.ts` | **`REDE 200`** no Playwright, com sessão real |
| Hook | `hooks/metrics/useAtritoMetrics.ts` | idem — o painel consome dele |
| Painel | `app/app/metrics/_components/AtritoPanel.tsx` | **✅ PROVADO NA TELA** — login real, 4 pares medidos por `getBoundingClientRect`, zero erros de console |

### Prova de tela — como foi feita (2026-08-06)

Ambiente: **Supabase local** (`127.0.0.1:54321`), `next build` + `next start` na
porta 3100, login real com `e2e-manager@deskcomm.test` via Playwright.

> ⚠️ **`.env.local` do repo aponta para a NUVEM DE PRODUÇÃO**
> (`rrydmwnporysaiysiztn.supabase.co`). O app foi subido com as vars do Supabase
> sobrescritas no `process.env` (o Next dá precedência a elas), e isso foi
> **medido, não presumido**: o HTML de `/login` referencia só `127.0.0.1:54321`,
> nenhuma ocorrência de `*.supabase.co`.

Cenário seedado na org de teste (5 demandas encerradas, uma com 6 retornos, 12
envios da IA / 8 humanos pelo sistema / 3 pelo celular, 2 vetos, 1 descadastro).

Medido na tela: 4 pares · `custoNoMesmoCard: true` em todos · `antesDoFunil: true`
· zero erros de console · sem scroll horizontal em 1280px.

### Defeitos MEUS achados na prova de tela — e corrigidos

A tela funcionava. A pergunta "está verdadeiramente bom?" achou quatro coisas:

| # | Defeito | Por que importava | Correção |
|---|---|---|---|
| 1 | **O sinal que motivou a spec não aparecia.** A função calculava `insistencia_max` (=6) e o painel publicava só a média (2.0) | Numa base de 40 demandas, seis retornos num único cliente somem na média — é exatamente o caso que a spec existe para denunciar. Medir o dano e escondê-lo na exibição é o mesmo defeito, um andar acima | Dano "Insistência no pior caso" ao lado da média + teste que exige os dois juntos e nessa ordem |
| 2 | Subtítulo da página mentia: "Funil e performance por atendente" | A página mudou de conteúdo e o texto não (invariante 5) | "Atrito, funil e performance…" — `grep` em `tests/` antes de mexer, nenhum teste dependia |
| 3 | Legenda do `—` aparecia mesmo sem nenhum `—` na tela | Ruído compete com o que importava (invariante 5) | Legenda condicional |
| 4 | Mediana e p90 idênticos (35min/35min) sem explicação | Dois números iguais lado a lado leem-se como bug | Nota condicional: "Igual à mediana: há poucas esperas medidas…" |

Reprovado na tela após a correção: `valorPiorCaso: "6"` visível ·
`legendaTravessaoPresente: false` · `notaBasePequena: true` · subtítulo corrigido.

### ⚠️ Pendente

1. **`lib/database.types.ts` não regenerado.** A RPC nova não está tipada. Medido
   nesta sessão: **o typecheck NÃO vigia nome de RPC** (`s.rpc("fn_que_nao_existe")`
   passa no `tsc --noEmit` sem erro), então isso não quebra o build — mas deixa o
   contrato desatualizado.
2. **Decisões de régua da Fase 2** (spec §5): definição de "primeira resposta
   útil", janela de abandono por canal, e o denominador definitivo.
3. **Spec 17 §7 (Living System Checklist): "atualizei o mapa?" segue pendente** —
   `docs/architecture/*.json` não reflete a peça nova.

---

## Fase 2 — abandono e a régua (2026-08-06)

### O que entrou

| Peça | Prova observada |
|---|---|
| Migration **0134** — `fn_atrito_metrics` ganha `p_abandono_horas` (default 72) + `abandonos` + `conversas_com_fala_nossa` | `test:db` verde; controle confirma **uma só função** de 4 args (o `drop` da de 3 funcionou) |
| Dano "Conversas que morreram no silêncio (após Nh)" no par Conversão | 35 unitários · 15 invariantes |
| `lerAbandonoHoras` — leitura defensiva de jsonb livre | 4 testes; **sabotagem 1/1** |
| `PATCH /api/v1/metrics/atrito` — muda a régua (manager+) | **PATCH 200 na tela**, com efeito no número |
| Controle da régua no cabeçalho do painel | **clicado de verdade** no Playwright |
| Audit `metrics.atrito_regua_changed` | linha confirmada em `api_audit_log` |

### A prova que vale — o ciclo completo, clicando

```
ANTES:  régua 72h  → abandono 50.0%
        [digitou 120 no campo, clicou em Salvar]
        REDE PATCH 200 → REDE GET 200
DEPOIS: régua 120h → abandono 40.0%   (rótulo do dano acompanhou: "após 120h")
```

A escrita foi provada **pelo efeito no número**, não por uma mensagem "salvo" —
que é exatamente o modo como o bug conhecido de `organizations` engana
(client de sessão casa 0 linhas e o PostgREST devolve sucesso).

Confirmado no banco, de forma independente: `settings->'atrito'` =
`{"abandono_horas": 120}`; audit gravado; e o merge preservou `llm`, `routing`,
`visibility_mode` e `canonical_conversation_tags` — nada foi sobrescrito.

### Defeitos achados e corrigidos nesta fase

| # | Defeito | Como apareceu | Correção |
|---|---|---|---|
| 1 | `Number(true) === 1` — um `true` no jsonb viraria "abandono após 1h" e o painel acusaria abandono em massa, com cara de dado | **Teste que eu mesmo escrevi reprovou** antes de qualquer prova de tela | `typeof` antes do `Number()`; sabotagem confirma 1/1 |
| 2 | O `as unknown as AtritoRaw` da rota escondia um `escopo` sem `abandono_horas` — a tela diria "após undefined h" | Revisão do próprio cast | Campo explícito no fallback |
| 3 | Controle da régua ficou no RODAPÉ, a três cards do número que governa | Prova de tela | Movido para o cabeçalho da seção |
| 4 | 0134 (então `0117`) sem linha no MANIFEST | **Gate `manifest-x-migrations` reprovou** | Linha adicionada |

### Decisão de desenho — por que a régua NÃO foi para `channel_knobs`

A spec §5.2 propunha `channel_knobs`. Ao abrir a superfície existente
(`AntiBanSheet`), ela se chama **"Proteção de envio"** e trata de anti-ban:
throttle, janela horária, warm-up. A janela de abandono não é proteção de
envio — é **régua de medição**. Colocá-la lá seria a peça certa no lugar errado,
e o operador procuraria por ela onde ela não está.

Foi para `organizations.settings->'atrito'`, exibida e editável **junto do
número que ela governa** — o que satisfaz o invariante 6 (ver + mudar + falha
visível) e a regra 4 do cap. 3.4 ao mesmo tempo.

### 🐛 Segundo achado PRÉ-EXISTENTE

`tests/unit/ai-response-worker-model-routing.test.ts > "o defeito, explicitado:
model como STRING nem emite requisição"` **falha na `main`**, medido com
controle: `git checkout main` + rodar o teste sem nenhum código desta branch →
`1 failed | 2 passed`. Meu diff não toca `workers/ai-response-worker.ts`.
Merece issue própria.


---

## Fase 3 — repetição e espera calada (2026-08-06)

| Peça | Prova |
|---|---|
| Migration **0135** — `fn_atrito_jaccard` + `p_repeticao_min` + `p_espera_horas` | `test:db` install+update; **uma só função**, 6 args |
| "Perguntas que a pessoa teve de repetir" | tela: **27,3%**, rotulada como PISO |
| "Esperas sem nenhuma resposta por mais de 4h" | tela: **6,5%** |
| Cobertura do detector | 5 invariantes novos (20 no total) · 40 unitários |

### A decisão técnica, e a medição que a produziu

A spec §5.1 propunha embedding. **Duas medições mataram essa ideia:**

1. `lib/ai/embed.ts` depende de `AI_GATEWAY_API_KEY`/OpenAI — env **opcional**.
   Num self-host sem chave a métrica ficaria em ZERO **em silêncio**, e zero ali
   lê como "o cliente nunca precisou repetir". Zero lisonjeiro na pior forma.
2. `baseline.sql` cria **apenas `pgcrypto`** — `pg_trgm` não é garantida em quem
   aplica só o baseline, que é o que o kit self-host faz.

Solução: **Jaccard de tokens em SQL nativo**. Sem extensão, sem chave, sem custo
por mensagem — a mesma técnica que o gate de spinning já usa neste repo.

### O limiar foi CALIBRADO, não chutado

Bateria de 15 pares pt-br em três classes:

| limiar | reperguntas pegas | falsos positivos |
|---|---|---|
| 0.5 | 6/7 | **3** |
| 0.6 *(meu palpite inicial)* | 5/7 | **2** |
| **0.7** | **3/7** | **0** ← escolhido |
| 0.8 | 2/7 | 0 |

**As faixas se sobrepõem:** repergunta 0.33–0.80, pergunta-diferente-sobre-o-
mesmo-tema 0.17–0.67 ("horário aos sábados" × "aos domingos" = 0.67). **Não
existe limiar que separe as duas classes com Jaccard puro.**

0.7 é onde o falso positivo zera. A assimetria de custo justifica: falso
positivo levaria alguém a "consertar" um agente que está certo; falso negativo
só subconta. Por isso o número é publicado como **PISO** e a tela o rotula
assim, com a limitação visível ("escapa desta medida").

Validado com dados reais: 3 reperguntas detectadas, **zero falsos positivos** —
a plantada (0.83) e duas mensagens literalmente idênticas (1.00).

### Dívida declarada da Fase 4

Reformulação com outro vocabulário ("qual o prazo" → "quanto tempo demora") mede
**0.00** e escapa. Quando houver embedding sem env opcional, esta camada vira o
filtro barato da frente e o vetor decide o resto. Um invariante guarda esse
limite para que ninguém "conserte" o número baixando o limiar sem recalibrar.

---

## Fase 4 — a demanda como entidade, e o denominador definitivo (2026-08-06)

Esta fase não é "mais uma métrica": ela arrasta o **capítulo 5 da doutrina**.

### 0119 — a entidade

O propósito é resolver demandas, e a unidade do propósito não existia. Medido:
`agent_cases` tinha 7 linhas e **zero com `lead_id`** — é caso de ESCALADA
(nasce só de handoff, 1:1 com conversa, não conhece o negócio).

`demandas` + `demanda_conversas` (N:N). Dono nunca vazio; próximo passo é
**campo**, não derivação; desfecho enumerado incluindo `encerrada_pelo_cliente`
e `expirada_sem_resposta`. Passo 1 do cap. 5 §5.6: **cria ao lado, nada é
removido**. Passo 2: deriva o passado por **regra escrita** (R1 casos, R2
conversas sem caso), nunca por heurística.

Provado: 12 demandas derivadas (7 de caso, 5 de conversa), 12 vínculos N:N.
Idempotente — testado com `drop`+re-apply E com re-apply sobre banco populado.

### 0120 — o denominador

O índice deixa de contar sobre casos (6) e passa a contar sobre demandas (5).
Os números mudam e **não é regressão**: antes media-se a fatia difícil, agora o
todo. Índice que só olha casos escalados superestima o atrito médio.

Insistência, toque humano e retrabalho continuam vindo de `agent_cases` pelo
ponteiro `demandas.agent_case_id`, e o payload declara `demandas_com_caso` como
denominador PRÓPRIO deles — medir insistência sobre o total diluiria o sinal no
lugar exato onde a spec 17 nasceu.

### O ganho maior não era o denominador

**O invariante 4 da doutrina virou NÚMERO.** "Nenhuma demanda sem próximo
passo" era verificável em teoria desde que foi escrito; agora é medida na tela:
`demandas_sem_proximo_passo` = **7 de 7 abertas** no banco de referência. Antes
da 0119 isso não era sequer enumerável.

### Gate que funcionou

Ao trocar o denominador, **4 invariantes quebraram na hora** — a fixture criava
casos e a função passou a contar demandas. Não foi acidente: foi o gate
detectando a troca. Fixture atualizada, 20/20.

### Provado na tela

Texto medido no painel, com login real:

```
Base: 5 demandas encerradas nos últimos 30 dias, e 7 ainda abertas.
   → a ressalva "entre as que passaram por atendimento humano" SAIU

Demandas abertas sem próximo passo
De 7 abertas agora. Cada uma é alguém esperando sem que nada
esteja marcado para acontecer.
   → o invariante 4 da doutrina, na tela, como número
```

Zero erros de console. As métricas das Fases 1–3 seguem intactas
(repergunta 27,3% como piso, espera calada 6,5%, abandono, pior caso).

### ⚠️ PENDENTE nesta fase — resolvido depois, ver abaixo

- ~~**Passo 3 do cap. 5**: criar demanda no ponto de entrada real.~~ **FEITO** na
  migration 0138 (commit `a1efbf17`) — trigger `fn_demanda_abre_no_inbound`.
- ~~**Passo 4 do cap. 5**: migrar os consumidores.~~ **Radar de Risco** (tela) e
  **capacidade da IA** migrados; ver as duas seções de passo 4 mais abaixo.

---

## O caso 5 — investigação concluída (2026-08-06)

**Sintoma:** sabotar o guard de `direction` do trigger não reprovava o caso 5,
embora o comportamento errado fosse real (medido no banco: com zero demanda
aberta, um outbound passava a criar demanda, 0 → 1).

**Causa raiz — e não era o teste:** o bloco da migration 0138 estava inserido
**quatro vezes** no `baseline.sql`. Meu script de atualização usou
`str.replace(marca, ...)` **sem `count=1`**, e a marca escolhida
(`notify pgrst, 'reload schema';`) aparece 4× no arquivo. A sabotagem editava a
primeira cópia; as três `create or replace` seguintes restauravam a função.

**Delimitação medida:** só os dois objetos da 0121 estavam duplicados.
`fn_atrito_metrics`, `fn_atrito_jaccard`, `demandas`, `demanda_conversas` e as
políticas estavam 1× — os blocos anteriores foram inseridos por índice, não por
marca repetida.

**Um erro no próprio conserto:** a primeira tentativa cortou também 3
ocorrências legítimas de `notify pgrst`. Peguei ao medir contra o commit
anterior (`git show cda9bedd` já tinha 4) e refiz delimitando o bloco por
início **e** fim, em vez de cortar por separador.

**Prova final:** com uma única definição, remover o guard reprova com
`expected 3 to be 2`. Previsão de 1 reprovação, resultado 1.

**Lição, registrada no cabeçalho do invariante:** teste verde sob sabotagem pode
denunciar o **artefato duplicado**, não o teste fraco. Antes de reescrever a
asserção, conte quantas vezes o objeto sabotado existe.

---

## Passo 4 do cap. 5 — primeiro consumidor migrado (2026-08-07)

**Radar de Risco passa a conhecer `demandas`**, e de forma INCREMENTAL de
propósito: a lógica de leads do módulo é compartilhada com a capacidade que a IA
usa (`lib/mcp/tools/retencao.ts`), e a tela e o agente têm de dizer a mesma
coisa sobre o mesmo negócio. Reescrevê-la arriscaria essa paridade sem
necessidade; acrescentar não arrisca nada.

O que entrou: `sem_proximo_passo` no payload do radar + seção na tela.

**Por que isto e não outro consumidor:** o índice de atrito já publica a
CONTAGEM do invariante 4 ("N demandas abertas sem próximo passo"). Contagem sem
lugar para agir viola o invariante 5 — todo dado responde "e daí?". Esta lista é
a resposta.

**Um bug que eu teria introduzido:** a tela do Radar mostrava o estado vazio com
`total === 0`. Com a seção nova, uma organização com 8 demandas sem próximo
passo e nenhum lead frio veria "Nenhuma demanda em risco" — escondendo
exatamente o vazamento que o invariante 4 existe para denunciar. O vazio agora
exige as DUAS listas vazias.

### Provado na tela (2026-08-07)

Login real, `/app/radar`, Supabase local:

```
secao_presente:        true
titulo:                "8 demandas abertas sem próximo passo"   ← bate com o banco (8)
itens_listados:        8
primeiro_item:         "Cliente Radar E2E — aberta há 259h"
antes_dos_counts:      true    (posição: antes dos contadores de risco)
scroll_horizontal:     false
erros de console:      nenhum
```

**E o caso do bug foi EXERCITADO, não presumido.** Na primeira medição havia 55
leads frios, ou seja `total > 0` — o estado vazio nem seria alcançado, e o teste
teria passado sem tocar no defeito que a correção existe para evitar.

Refeito com backup e restauração: `last_activity_at` de todos os leads abertos
empurrado para agora (leads frios → 0), mantendo as 8 demandas sem próximo
passo. Resultado: `estado_vazio_indevido: false` — a tela mostrou as 8 demandas
em vez de "Nenhuma demanda em risco". Ambiente restaurado (65 linhas).

---

## Passo 4 do cap. 5 — a IA também enxerga (2026-08-07)

O Radar deu a lista ao **humano**. Faltava o outro lado do invariante 2
(continuidade IA↔humano nas duas direções), e ele importa mais aqui do que
parece: quem pode agendar o retorno que falta, às três da manhã, é a IA.

### O defeito era invisível por construção

`crm_list_at_risk_leads` chama `carregaRadarDeRisco` e faz `return radar` — ou
seja, **`sem_proximo_passo` já viajava no payload desde ontem**. E não servia
para nada: o modelo só usa o que a `description` promete. Dado que chega e não
é declarado é, para o agente, o equivalente exato de um campo que a tela recebe
e não pinta.

A `description` agora declara o campo, os subcampos e — o que fecha o laço — as
duas saídas: `crm_schedule_followup` (por `contact_id`, que é o que a lista
traz) ou `crm_close_demand`. Sem nomear a saída, o modelo enxerga o problema e
não sabe o que fazer com ele.

### O achado que valia mais que a tarefa

`carregaRadarDeRisco` faz **7 leituras tenant-aware com service role** — e
`service role bypassa RLS, então o `.eq("organization_id", …)` é a única
defesa`. Medido nesta sessão:

```
Sabotagem: remover o filtro de org da leitura de `demandas`
Previsão:  0 reprovações        Resultado: 0    ← o buraco
```

O teste que existia se chamava *"não vaza negócio de outra organização — **toda
leitura** filtra a org do contexto"* e exercitava **uma** leitura (`crm_leads`),
com o resolver devolvendo `[]` — o que fazia a função retornar cedo e as outras
seis nem acontecerem. O nome prometia mais do que a asserção media, e a leitura
que **eu mesmo adicionei ontem** entrou sob esse álibi. É o anti-pattern #10 da
doutrina do repo, introduzido por mim e não pego por nada.

### Duas camadas, porque uma não alcança a outra

| Camada | Onde | O que só ela pega |
|---|---|---|
| Unitário | `tests/unit/mcp-retencao-tools.test.ts` | que o filtro é **emitido**, nas 7 leituras |
| Sonda de código | `tests/sonda-radar-isolamento-orgs.ts` | que o filtro **separa** de verdade, com 2 inquilinos reais |

A sonda não virou invariante de `test:db` por um motivo medido:
`scripts/test-db.sh` sobe **só Postgres**, sem PostgREST — `carregaRadarDeRisco`
fala por supabase-js e não roda lá. Um invariante em SQL só poderia reescrever o
predicado, que é testar o teste. Por isso a prova chama a **função**, contra o
Supabase local, com org A e org B.

### Sabotagens — previsão antes de rodar

| Sabotagem | Previsão | Resultado | |
|---|---|---|---|
| Filtro de org fora da leitura de `demandas` (unit) | 1 | **1** ✅ | a mensagem nomeia a tabela culpada |
| Ignorar o array do join do PostgREST | 1 | **1** ✅ | o nome do contato sumiria da lista do agente |
| `description` promete campo inexistente | 1 | **1** ✅ | promessa vazia ao modelo reprova |
| **A ponte monta a description do CATÁLOGO** | 1 | **1** ✅ | a mais realista: é o erro que o cabeçalho errado induz |
| Filtro de org fora (sonda, 2 orgs) | 5 | **7** ⚠️ | ver abaixo |

**A quarta divergiu, e a causa ensina.** Previ 5 supondo um banco com só os meus
4 registros; o banco local tem demandas de outras orgs, então o vazamento traz
10 e derruba também o caso do nome. Ensaio em banco sujo — a previsão foi contra
um ambiente imaginado.

E a divergência expôs **uma asserção fraca minha**: *"A1 é o contato certo"*
passava **sob vazamento**, porque `has()` num conjunto que vazou o mundo inteiro
é sempre verdadeiro. Trocada por igualdade de conjunto (`size === 1 && has`).
Refeito: previsão 7, resultado **7**, controle 8/8 com exit 0.

### 🐛 Achado: a `description` do catálogo é código morto

`lib/mcp/tools/catalogo/*.ts` declara `description` em **51 capacidades** e o
cabeçalho do arquivo diz textualmente *"`description` fala com o modelo"*.
Medido: **ninguém lê esse campo.**

```
lib/ai/runtime/tools.ts:57      description: def.description   ← do HANDLER
lib/mcp/tools/catalogo-servido.ts:58  description: handler.description  ← do HANDLER
catalogEntry(...) é usado para: rotulo, risco, apenasHumano, pacotes — nunca description
```

Quem editar a description do catálogo acreditando no cabeçalho **não muda nada**
no comportamento do agente.

**Um gate de paridade nasceria vermelho** — medido: das 51 capacidades, **48
divergem** entre handler e catálogo (as do catálogo são versões resumidas). Não
alinhei as 48: é fora do escopo e alto risco de mexer no que fala com o modelo
em 48 lugares de uma vez.

O que fiz em vez disso foi fechar o **call site** do meu próprio trabalho:
`"a promessa chega ao MODELO — a ponte monta a descrição do handler"` exercita
`pickToolsFromMcp` e exige `montada.description === crmListAtRiskLeads.description`.
Sabotado com `catalogEntry(def.name)?.description ?? def.description` (o erro que
o cabeçalho induz): previsão 1, resultado **1**.

Dívida declarada: ou o campo do catálogo vira fonte única, ou sai do tipo, ou
ganha gate de paridade com a dívida das 48 congelada (padrão "gate que nasce
vermelho": congela o existente, reprova só o novo).

### Provado na tela (2026-08-07)

`/app/ai/agents/<mcp_agent>`, login real com `e2e-manager`, Supabase local
(controle: o HTML de `/login` referencia `127.0.0.1:54321` **2×** e
`*.supabase.co` **0×**).

```
presente:              true
texto:  "Ver quem esfriou e quem ficou sem próximo passo · Só consulta · Radar de risco
         Lista as oportunidades abertas que passaram do prazo sem movimento, das mais
         críticas para as menos urgentes — e, junto, as pessoas que estão esperando
         sem que nada esteja marcado para acontecer."
largura: 404px   altura: 155px   dentro_da_viewport: true
jargao:  []      scroll_horizontal: false      erros de console: nenhum
```

`tests/sonda-capacidade-radar-tela.ts` · evidência em
`evidence/passo4-capacidade-radar.png` · 6/6, exit 0.

**Duas armadilhas de ambiente, ambas diagnosticadas e não chutadas:** o
`e2e-admin` tem MFA forçado (doutrina) e trava o login da sonda — usar o
`manager`; e o primeiro agente que escolhi era `kind='rag_bot'`, que cai no
**editor legado sem `ToolPicker`** (`page.tsx:53`). A sonda fixa um `mcp_agent`
e o comentário explica por quê, para o próximo não perder o mesmo tempo.

---

## Passo 4 do cap. 5 — o inbox, e com ele o passo FECHA (2026-08-07)

O painel lateral do inbox mostrava negócio, pedido e histórico: três listas
sobre o que **já aconteceu**. Nenhuma responde à pergunta que a pessoa do outro
lado está fazendo — *o que eu pedi e ainda não foi resolvido*. O caso concreto:
o atendente encerra a conversa, a demanda segue aberta e sem próximo passo, e o
vazamento só reaparece depois como número numa métrica que ele não abre.

**Correção da afirmação anterior deste handoff:** eu havia escrito "o inbox
segue lendo `crm_leads`" e procurado em `app/app/inbox/`. Lá não há nada — o
inbox é só um redirect. A leitura vive em `app/api/v1/contacts/[id]/crm-summary`
e o painel em `components/inbox/CRMSidePanel.tsx`. A afirmação estava certa em
espírito e errada de endereço.

### O desenho da rota, que eu segui em vez de contornar

`crm-summary` usa **client de sessão** (RLS ativa), não service role — e tem uma
regra explícita: *"um pedido, um veredito"*, as consultas falham juntas. Isso
existe porque o defeito original era erro de permissão traduzido em `Sem leads.`
A 4ª consulta entra no mesmo `Promise.all` e no mesmo `??` de falha. Se
`demandas` falhar, a rota falha inteira — em vez de a seção nova dizer "nenhuma
demanda aberta" em cima de um erro.

### O risco real era a RLS, e por isso a prova de tela é a que vale

A política de `demandas` chama `fn_user_org_ids()`. Se a leitura de sessão não
passasse, o painel diria "Nenhuma demanda aberta." para sempre — o defeito que a
rota veio curar, reintroduzido por mim numa seção nova. Um teste unitário com
`apiClient` mockado **não pega isso**.

`tests/sonda-inbox-demandas-tela.ts` — 15/15, exit 0, com 2 demandas semeadas no
banco (uma sem próximo passo) e a contagem do banco como régua:

```
texto na tela:  "DEMANDAS ABERTAS
                 Aberta · há 9h · Sem próximo passo definido      ← destacada
                 Em atendimento · há 3h · Enviar o orçamento revisado"
noBanco: 2      itens na tela: 1 sem passo + 1 com passo = 2      ← bate
statusSummary: 200 · a RLS deixou ler · antes dos negócios: true
scroll horizontal: false · erros de console: nenhum

SOB FALHA (rota interceptada com 500):
  confessa "Não consegui ler": true · mente "Nenhuma demanda": false
  oferece "Tentar de novo": true
```

Evidência: [caminho feliz](passo4-inbox-demandas.png) ·
[sob falha](passo4-inbox-demandas-falha.png).

### Sabotagens — previsão antes de rodar

| Sabotagem | Previsão | Resultado | |
|---|---|---|---|
| Todas as demandas com o mesmo `data-testid` | 1 | **2** | esqueci que o teste da frase também busca por testid |
| A frase "Sem próximo passo definido" some (fica só a cor) | 1 | **1** ✅ | acessibilidade é vigiada |
| A seção vai para depois dos negócios | 1 | **1** ✅ | ordem é afirmação de qual é a unidade |
| O flag `erro` não é setado | 1 | **1** ✅ | falha volta a parecer ausência |
| `setDemandas(null)` → `setDemandas([])` no catch | 1 | **0** ⚠️ | ver abaixo |

**A última reprovou ZERO, e isso corrigiu meu modelo mental.** Eu creditava a
proteção ao `setDemandas(null)`; o que realmente impede a mentira é o
`setErro(true)`, que faz o `SemLista` mostrar "Não consegui ler"
independentemente da lista estar `[]` ou `null`. O `null` é consistência com as
irmãs, não a defesa. Mecanismo redundante identificado e crédito reatribuído — a
sabotagem que vale para aquele caso é a do flag, e ela reprova 1.

### 🐛 Achado PRÉ-EXISTENTE, medido com controle: o painel do inbox não cabe na tela

| viewport | painel fica fora da viewport |
|---|---|
| 1280px | **311px** |
| 1440px | **151px** |
| 1920px | cabe (−24px) |

`InboxLayout.tsx:164` usa `xl:grid-cols-[300px_1fr_320px]`, e o `xl` do Tailwind
dispara em 1280 — a terceira coluna nasce no exato ponto em que não há espaço
para ela. Pior: `scroll_horizontal` é **false**, então **não há como alcançar** o
que ficou fora.

**Controle que prova não ser meu:** a seção `CONTATO`, que existe desde antes
desta branch, está exatamente tão fora quanto a minha (295px, mesma
`left`/`right`). É o layout, não o conteúdo.

Em 1280px — resolução de trabalho comum — o atendente não vê o painel de CRM
nenhum. Vale issue própria, e é da mesma família do overflow de 390px já
registrado.

### Ambiente consertado de passagem

`.e2e-creds.json` tinha o segredo TOTP do admin **divergente do banco**
(`YVVB64YO…` no arquivo, `RYA6TA36…` em `auth.mfa_factors`) — outra rodada do
seed rotacionou e o arquivo ficou para trás. Corrigido a partir do banco; o
login de admin nas sondas voltou a funcionar.

### ⚠️ NÃO MEDIDO — e a causa

`tests/sonda-painel-inbox.ts` (a guarda antiga do painel, que estendi para
incluir "Nenhuma demanda aberta." na lista de frases que não podem aparecer sob
falha) **não roda neste banco**: sua fixture `Ana Souza LGPD E2E` não existe
aqui — medido, **0 contatos**. A extensão está escrita e não foi executada.

Isso não deixa buraco de cobertura: o mesmo comportamento está provado (a) no
teste unitário, caso 3, com sabotagem do flag `erro` confirmada 1→1, e (b) na
tela, na fase "SOB FALHA" da sonda nova. Mas a linha que escrevi naquele arquivo
segue sem execução, e isso fica declarado.

---

## O inbox cabe na tela (2026-08-07)

O achado da seção anterior virou trabalho. **Em 1280px o painel de CRM não
existia na tela** — nem cortado, nem parcial: ausente. Ver
[antes](inbox-antes-1280.png) e
[depois](inbox-cabe-1280.png), mesma conversa, mesma largura.

### A causa não era onde parecia

O suspeito óbvio era o grid (`xl:grid-cols-[300px_1fr_320px]`, e o `xl` do
Tailwind dispara justamente em 1280). Mas a medição apontou para outro lugar:

```
grid-template-columns resolvido, de 1280 a 1536:  "300px 706.953px 320px"
                                        em 1920:  "300px 1012px    320px"
```

A coluna do meio **travava em 706,95px** — o `min-content` dela. `1fr` é
`minmax(auto, 1fr)` e não encolhe abaixo do conteúdo. Medindo filho a filho:
thread pedia 132px, composer 370px, e o **`ConversationHeader` pedia 707**,
porque sua barra de ações era `shrink-0`. Um `shrink-0` numa barra de botões
estava definindo a largura mínima da aplicação inteira.

### Correção da minha própria afirmação

No handoff anterior escrevi que o painel era "inalcançável". Errado: o `main`
tem `overflow-x: auto` e `scrollWidth 1351 > clientWidth 1040` — havia scroll,
no `main`, não no documento. Eu medira o do documento. Continua sendo defeito
(rolar o inbox de lado para ver o CRM é ruim e ninguém descobre), mas menos
grave do que afirmei.

### Como escolhi: prototipagem medida, não palpite

Cada `next build` custa ~2min. As variantes foram injetadas por CSS no browser
já renderizado e medidas na hora (`tests/__proto-layout.ts`, descartado depois),
em 5 larguras:

| variante | fora da viewport | thread @1280 | ações perdidas |
|---|---|---|---|
| V0 atual | 311 / 225 / 151 / 55 / 0 | 707 (travado) | 0/5 |
| V1 header reorganiza | **0 em todas** | 372 | 0/5 |
| V2 V1 + `minmax(0,1fr)` | 0 em todas | 372 | 0/5 |
| **V4 duas faixas** | **0 em todas** | **424** | 0/5 |
| V5 V4 + gap menor | 0 em todas | 424 | 0/5 |

Três decisões saíram daí, e nenhuma teria saído de raciocínio:

1. **`minmax(0,1fr)` não entrou.** V2 mediu idêntico a V1 — consertado o header,
   o `1fr` volta a encolher sozinho. Seria mudança sem efeito.
2. **V1 sozinho é frágil.** 372px de thread contra um piso de 370 do composer é
   2px de folga. Margem de 2px não é margem, é sorte. V4 (duas faixas: compacta
   no `xl`, generosa no `2xl`) dá 424px — 54px de folga — e preserva as laterais
   generosas onde há espaço.
3. **V5 descartado.** Apertar o gap dos botões economizava 4-6px de altura; o
   ganho não paga a densidade visual.

### A lapidação que não era sobre caber

Com o layout corrigido, sobraram dois incômodos que só aparecem olhando:

**O placeholder passou a quebrar.** "Escreva uma mensagem… (Enter envia,
Shift+Enter quebra linha)" não cabe numa coluna de 424px e quebrava em duas
linhas dentro de um campo de uma linha só. Aqui a screenshot me enganou e a
medição corrigiu: eu havia lido como "composer cortado", e `composer_cortado`
media **0** em todas as variantes — era texto, não layout.

O atalho saiu do placeholder e foi para o diálogo de atalhos (`?`) e para o
`title`. Dois motivos, nesta ordem: **ele some assim que se digita a primeira
letra** — isto é, some exatamente quando você ia quebrar linha. E o diálogo de
atalhos, que é o lugar canônico, **não tinha o atalho mais usado do inbox**.
`"(só o time vê)"` da nota interna ficou: não é atalho, é consequência, e quem
escreve uma nota precisa saber que ela não vai para o cliente sem abrir diálogo
nenhum.

**"Ver contato" aparecia duas vezes na mesma tela** — no header e no card
CONTATO do painel — e era justamente ele que sobrava na segunda linha. Medido:

| | 1024 (sem painel) | 1280 | 1440 |
|---|---|---|---|
| com duplicata | 2 linhas, no header ✅ | 2 linhas, **duplicado** | 1 linha |
| sem duplicata ≥ xl | 2 linhas, no header ✅ | **1 linha** | 1 linha |

`xl:hidden` — a mesma largura em que o painel entra. Abaixo dela o painel não
existe e o botão é a única porta, então continua lá. Não é esconder ação; é
parar de repeti-la.

### Resultado medido (`tests/sonda-inbox-cabe-na-tela.ts`, 10/10, exit 0)

```
    vp   fora  painel  thread  hdr_h   acoes  portas  rola(main/doc)
  1280      0     296     424    107     0/4       1  false/false
  1366      0     296     510    107     0/4       1  false/false
  1440      0     296     584    107     0/4       1  false/false
  1536      0     320     628     63     0/4       1  false/false
  1920      0     320    1012     63     0/4       1  false/false
```

Contra o antes: `fora` era 311/225/151/55/0 e `thread` era 707 travado.
[1280px](inbox-cabe-1280.png) ·
[1920px, o controle de que nada regrediu no largo](inbox-cabe-1920.png).

### Duas camadas de guarda, e a limitação declarada

`min-content`, quebra de flex e resolução de grid são **cálculo de layout**, e o
jsdom não tem engine de layout — um teste lá mediria zero em tudo e passaria
feliz. Por isso:

- `tests/sonda-inbox-cabe-na-tela.ts` — a medição de verdade, num browser, nas 5
  larguras. **Não roda no CI.**
- `tests/unit/inbox-header-nao-trava.test.tsx` — catraca que roda no CI. Olha
  CLASSE, não pixel, e isso está escrito no cabeçalho dela: pega a regressão
  específica (alguém devolver `shrink-0` "para os botões não quebrarem") e nada
  além disso.

Sabotagens: `shrink-0` de volta → previsão 1, **resultado 2** (minha sabotagem
trocou o `className` inteiro, levando junto `flex-wrap`); `flex-wrap` fora do
container → 1 → **1**.

### Defeitos meus, achados no caminho

| # | O quê | Como apareceu |
|---|---|---|
| 1 | Mock de `useResumeAi` — módulo que **não existe** (o real é `useResumeAiAttendance`) | O teste passava porque o hook verdadeiro rodava sob o provider: o mock não mockava nada e ninguém era avisado |
| 2 | Crases dentro de template literal na sonda | `tsc` reprovou — mesmo erro que já cometi com SQL em template literal |
| 3 | **Duas imagens versionadas sem citação** no commit `3227bf81` | O gate `evidencia-citada` reprovou. O pre-commit não roda a suíte, então aquele commit deixou o CI vermelho e eu não vi |

### Correção de um número que publiquei

A mensagem do commit `c56416aa` diz **1819 unitários**. O real naquele SHA é
**1818** — medido depois, com `git stash` e a árvore limpa em `c56416aa`.

A causa não é aritmética: rodei a suíte com a árvore **ligeiramente diferente**
da que foi commitada (antes do `rm` do protótipo e do stage final) e publiquei o
número como se fosse do commit. Medir contra árvore em movimento é medir contra
nada, e o erro passou porque o número vinha cercado de material medido com
rigor. Régua para a próxima: número que sai num artefato público (commit, PR,
handoff) é medido **depois** do stage, não antes.

---

## A `description` morta do catálogo — resolvida por remoção (2026-08-07)

A dívida declarada duas seções acima virou trabalho. `lib/mcp/tools/catalogo/*.ts`
declarava `description` em **51 capacidades**, o tipo a documentava como
*"Texto tecnico entregue ao MODELO"*, os cabeçalhos de 7 arquivos repetiam
*"`description` fala com o modelo"* — e **ninguém lia esse campo**.

### Por que remover, e não sincronizar

| caminho | por que não |
|---|---|
| fonte única (runtime passa a ler o catálogo) | mudaria o que **48 tools** dizem ao modelo. Risco alto, ganho zero |
| gate de paridade com a dívida congelada | obriga manter dois textos sincronizados **para sempre**; a duplicata continua existindo para ser editada por engano |
| **remover o campo** | mata a armadilha na raiz — não dá para editar o lugar errado se o lugar não existe |

E a remoção **se auto-verifica**: tirei o campo do tipo e o `tsc` apontou cada
leitura. Prova mais forte que qualquer grep.

### O que o typecheck encontrou — a dívida não era teórica

Um leitor, e o pior possível:
`evidence/ia-360-w4/medicao-vazamento/remedir-com-operador.ts`, o script que
mede vazamento de vocabulário do agente. A função dele se chama
`descreverFerramentas` e o comentário diz **"A ferramenta como o modelo a vê:
nome + descrição, que é o que pode vazar"** — e ele lia
`TOOL_CATALOG.description`, exatamente o texto que o modelo **não** vê.

**O que NÃO medi:** se isso muda o resultado daquela medição. O `name` da tool é
idêntico nas duas fontes e é o vetor principal de vazamento, então o efeito pode
ser nulo — mas não rodei. Corrigi a fonte (`allTools`) para a próxima rodada ler
o que vai ao modelo, e deixei a ressalva escrita no próprio script. Não reabri a
medição arquivada de outra branch.

### O buraco que a remoção expôs

`tests/unit/catalogo-servido.test.ts` testava a junção com **fixtures**
(`description: "faz algo"`), nunca com o catálogo real. Ou seja: **nenhum gate
garantia que uma capacidade servida tem descrição.** Esvaziar a `description` de
um handler passaria calado — a tela mostraria a capacidade sem explicação e o
modelo receberia uma ferramenta sem contrato, dois silêncios de uma vez.

Caso novo: toda capacidade servida tem descrição não-vazia **e ela é idêntica à
do handler**. A segunda metade é a que importa: se um dia reaparecer uma cópia no
catálogo e a junção preferi-la, o gate reprova.

| Sabotagem | Previsão | Resultado | |
|---|---|---|---|
| `description` de um handler vira `""` | 1 | **1** ✅ | primeira tentativa não sabotou nada: escrevi `description: "" \|\|`, e `"" \|\| "texto"` devolve o texto — instrumento quebrado, não gate fraco |
| a junção passa a servir outro texto | 1 | **2** | reprovou o caso novo e mais um |

### Saldo

130 linhas removidas contra 63 acrescentadas em 9 arquivos. Os 7 cabeçalhos que
afirmavam a falsidade foram reescritos com o que é verdade e **por que** o campo
não existe mais — para ninguém "completar" o catálogo de volta. O
`BRIEFING-ia-360.md`, que também declarava o campo como "vai para o MODELO",
acompanhou.

`typecheck 0` · `lint 0 errors` · **1819 unitários** (1818 no `c56416aa` + 1
caso novo — desta vez medido com a árvore parada).

### Pendente

- Nada desta dívida.

---

## Fechando as pendências — e o buraco que um gate novo denunciou (2026-08-07)

### `lib/database.types.ts` regenerado

Gerado do Supabase local e conferido **antes** de substituir: 9 tabelas entram
(`demandas`, `demanda_conversas` entre elas), 38 funções entram
(`fn_atrito_metrics`, `fn_atrito_jaccard`), e **nada some** — que era a única
pergunta perigosa. As funções de extensão que aparecem (`citext`, `gtrgm_*`)
seguem a convenção do arquivo, que já trazia `show_trgm` e `show_limit`.

**Sem prettier, de propósito.** Formatar levava o diff de 935/74 para 5995/5147:
o arquivo é gerado e a próxima geração desformata de novo, então o custo é
recorrente e o ganho é zero (ninguém lê esse arquivo à mão).

Anotação de passagem: o banco local tem `vector`, `uuid-ossp`, `pg_trgm` e
`citext`; o `baseline.sql` tem **uma única** linha `CREATE EXTENSION`, e é
`pgcrypto`. Não é defeito solto — `scripts/test-db.sh` tem um prelude que cria as
demais antes de aplicar o baseline, com comentário explicando. É contrato
conhecido, e fica registrado porque o grep ingênuo (case-sensitive) diz outra
coisa.

### O mapa de arquitetura, e o gate que faltava

`docs/architecture/indice-de-atrito.architecture.json` — 24 peças, 31 arestas, 5
faixas, com as **três não-ligações deliberadas** e o laço de retorno declarado.

Mas os mapas **não passavam por gate nenhum**, e o item 13 do DoD pede "peça nova
com ≥2 arestas". Sem verificação isso é honra. `tests/unit/mapas-de-arquitetura.test.ts`
cobre os modos de falha silenciosos: aresta para id inexistente, node em lane
inexistente, `mainPath` citando id morto, e peça órfã. Ele é **estrutural** — não
julga se o mapa descreve a realidade do código, e isso está escrito no cabeçalho
em vez de subentendido.

`crm-vivo` entra com dívida CONGELADA (≤4 órfãos): o README declara que aquele
mapa é planta, não fotografia. Só não pode piorar.

### 🐛 O gate reprovou o MEU mapa — e o defeito era de produto

```
inbox com menos de 2 arestas — é ilha pelo invariante 1: expected 1 to be >= 2
```

Verdade: o painel do inbox **recebia** a lista de demandas sem próximo passo e
não oferecia nenhuma forma de resolvê-las. O atendente via o vazamento e tinha
de sair da tela — o mesmo defeito do invariante 5 que eu havia corrigido no
Radar, repetido um andar adiante.

O remédio não era afrouxar o gate:

| Peça | O quê |
|---|---|
| `PATCH /api/v1/demandas/[id]` | piso **agent** — quem atende é quem sabe o que vem a seguir; exigir gerente empurraria o registro para "depois", que é o estado que isto vem eliminar |
| `MarcarProximoPasso` no painel | fechado por padrão (a lista tem várias demandas; campo aberto em cada uma viraria formulário) |
| Audit `demanda.proximo_passo_definido` | a única mutação que fecha o vazamento não podia ser a única sem rastro |

Duas decisões de desenho que valem registro: o update filtra
`fechada_em is null` — marcar próximo passo de demanda encerrada é reabrir pela
porta dos fundos, sem desfecho e sem ninguém saber; e o `select` de volta separa
"gravou" de "não achou", porque zero linhas no PostgREST é indistinguível de
sucesso (é assim que o bug conhecido de `organizations` engana).

Sabotagens: botão em toda demanda → 1 → **1**; salvar sem chamar o PATCH →
1 → **2**; falha fechando o campo → 1 → **1**.

### ✅ O ciclo completo, provado na tela (21/21, exit 0)

`tests/sonda-inbox-demandas-tela.ts` — clicar → escrever → salvar →
**conferir no banco** → conferir o audit:

```
CICLO: statusPatch          200
       noBancoDepois        "Enviar o orçamento revisado
                             Enviar a segunda via do boleto"   ← gravou
       aindaSemPasso        0
       naTelaDepois.sem_passo  0      ← a tela releu e o vazamento sumiu
       audit                1         ← demanda.proximo_passo_definido
```

Evidência: [depois de marcar](passo4-inbox-proximo-passo.png). A confirmação vem
do **banco**, não de uma mensagem de sucesso na tela — é assim que o bug conhecido
de `organizations` engana (PostgREST devolve 200 tendo casado zero linhas).

### O caminho até essa prova, porque ele foi todo em falso positivo

**1. O Supabase local caiu no meio da sessão.** Medido, não suposto: `curl` no
kong devolveu `000` enquanto o app respondia `200`, e depois o próprio daemon do
Docker parou de responder. Controle que fechou o diagnóstico: a sonda de layout,
verde minutos antes, passou a falhar **no mesmo ponto**. Era ambiente, não
edição. Resolvido matando e subindo o Docker de novo — o Rafael confirmou por
experiência que travado assim não tem outro jeito.

**2. Uma asserção MINHA reprovou produto correto.** `noBancoDepois === PASSO`
comparava uma string com o resultado de uma consulta que devolve **todas** as
demandas da marca com próximo passo — a semeada já com passo, e a recém-marcada.
Trocado por `includes`. O produto estava certo o tempo todo; a régua é que
estava errada.

**3. O login da sonda era INTERMITENTE — e o rastro dizia onde olhar.** Duas
rodadas falharam com buckets `auth:login_fail:id:` de **hashes diferentes**
(`f5e9836…` e `30ebfc5…`). Mesmo usuário daria o mesmo hash, então o que variava
era o texto que chegava: `pressSequentially` perdia caracteres enquanto a página
montava, e o servidor via um e-mail truncado. Não era rate limit — o audit
mostrou `auth.login_failed`, nunca `auth.login_rate_limited`.

Consertado com um `entrar()` que **confere o que digitou** antes de submeter, com
até 3 tentativas e erro explícito se o campo não aceitar. Instrumento que erra às
vezes é pior que um que erra sempre: leva a diagnosticar o produto.

---

## Sabotagens — o que foi provado que os testes pegam

Verde não prova nada; o que prova é o teste reprovar quando deveria. Cada
sabotagem teve **previsão de contagem antes de rodar**.

| Sabotagem | Previsão | Resultado | O que isso prova |
|---|---|---|---|
| Predicado do abandono perde "falamos por último" | 2 reprovações | **2** ✅ (`expected 2 to be 1`) | O controle negativo distingue "abandono" de "toda conversa em que falamos" |
| `lerAbandonoHoras` sem o guard de `typeof` | 1 reprovação | **1** ✅ | `true` no jsonb não vira régua de 1 hora |
| Esvaziar `danos` de todos os pares | 6 reprovações | **6** ✅ | A regra 3.3 (eficiência nunca publicada sozinha) é gate real, não comentário |
| `razao()` devolver `0` em vez de `null` | 3 reprovações | **3** ✅ | O zero-lisonjeiro é vigiado: org sem envio não reporta "0% de contorno" |
| `fn_atrito_metrics` → `SECURITY DEFINER` | 1 reprovação | **1** ✅ (`expected 1 to be +0`) | **Vazamento entre inquilinos reproduzido**: a função entregou a demanda da org vizinha a um usuário da org A. O invariante o pega |

A terceira é a mais importante: ela demonstra que promover a função a definer
"para simplificar" vira vazamento — e que o CI reprova antes disso chegar na main.

---

## Bugs e armadilhas encontrados no caminho

| # | O quê | Causa | Estado |
|---|---|---|---|
| 1 | Fixture do invariante estourava FK em `agent_cases` | `seedGov` já gasta o par (`GOV_CONTACT_1`, `GOV_SESSION`) e `conversations` tem unique nele → meu insert caiu no `on conflict do nothing` **em silêncio**, e a FK só estourou depois, longe da causa | ✅ corrigido — contato próprio, que também isola as contagens de outras suítes |
| 2 | `ON CONFLICT` recusado em `agent_cases` | A tabela tem unique **deferrable**, e o Postgres não a aceita como árbitro | ✅ corrigido — idempotência por limpeza explícita |
| 3 | Porta 54329 ocupada por container de **outra sessão** | Ambiente compartilhado | ✅ contornado com `TEST_DB_PORT=54341` — o container alheio **não** foi tocado |
| 4 | `page.fill()` no login não logava ("Email inválido") | O form usa react-hook-form, que escuta eventos de teclado; `fill` seta o valor sem disparar o que ele espera | ✅ `pressSequentially` — **bug da sonda, não do app** |
| 5 | `page.evaluate(() => …)` quebrava com `__name is not defined` | O esbuild do `tsx` injeta helpers que não existem no contexto da página | ✅ medição passada como **string** |
| 6 | Migration nasceu como `0115`, número já tomado | A `0115` existe na branch `feat/tres-papeis-do-agente` | ✅ renumerada para `0116` — **pego pelo hook de pre-commit**, não por mim |
| 7 | `0116` colidiu DE NOVO, agora com a `0116_definer_nova_nasce_exposta` do PR #189 | O #189 entrou na `main` primeiro; cada PR passava sozinho e o segundo derrubaria `manifest-x-migrations`, que roda no `verify` obrigatório | ✅ renumeradas para `0133`–`0138` na triagem (as seis, para o NNNN voltar a acompanhar o timestamp: só a `0116` colidia, mas renumerar três de seis deixaria as mais antigas com os números mais altos) — a linha 6 acima fica como está, porque descreve o que aconteceu **naquele** momento |

### 🐛 Achado PRÉ-EXISTENTE (fora do escopo, não é regressão desta branch)

**A aplicação tem overflow horizontal em telas de 390px.** Medido:
`scrollWidth=602` contra `clientWidth=390` — **idêntico em `/app/inbox`,
`/app/kanban` e `/app/metrics`**, e todos os elementos culpados têm
`dentroDoAtrito: false`. É do layout/header global, não do painel novo.

Controle em `tests/sonda-overflow-controle.ts`. **Vale abrir issue própria** —
num produto self-host, uma tela que não cabe no celular é primeira impressão ruim.

### Instrumentos quebrados que quase viraram medição (3 vezes nesta sessão)

Registrado porque é padrão, não acidente:

- `perl -0pi -e` falhou com erro de sintaxe → arquivo **não** foi sabotado → teste
  passou verde e pareceu que o gate não pegava.
- `grep ... | head` mascarou o exit code → o `||` de fallback nunca disparou → o
  controle não reportou nada e o silêncio pareceu resultado.
- `grep "create policy"` **case-sensitive** contra um dump que usa `CREATE POLICY`
  → concluí que `contacts` não tinha policy. Tinha.

**Lição operacional:** toda sonda leva controle positivo junto. Silêncio de
ferramenta é indistinguível de achado.

---

## Decisões tomadas (e por quê)

- **Denominador = `agent_cases` fechados**, com escopo **rotulado na tela**
  ("entre as que passaram por atendimento humano"). A unidade de demanda de
  verdade é o cap. 5 da doutrina e ainda não existe. Índice com escopo declarado
  é honesto; índice que finge cobrir tudo destrói a comparação quando o escopo mudar.
- **`SECURITY INVOKER`**, igual à `fn_attendant_metrics`. Definer daria org-wide a
  quem a RLS restringe — e a sabotagem acima mostra exatamente isso acontecendo.
- **Sem filtro por atendente.** Atrito é propriedade do sistema; quebrá-lo por
  pessoa convida a otimização local que degrada o todo (doutrina §3.6).
- **Painel ACIMA do funil e da performance.** É o número do sistema inteiro, ao
  qual as métricas de área se subordinam. Embaixo, viraria rodapé.
- **`external_device` entra no denominador da automação.** Excluí-lo inflaria a
  taxa numa org onde o time responde pelo celular: ali a IA não absorveu, ela só
  não foi usada.

---

## Achado que mudou o desenho

`messages.sent_via` tem três valores, e o terceiro não estava previsto na spec:

| Valor | Significa |
|---|---|
| `ai` | O agente respondeu |
| `user` | Humano respondeu **pelo sistema** |
| `external_device` | Humano respondeu **pelo celular, fora do sistema** |

O terceiro virou a **taxa de contorno** — quantas vezes o operador contornou a
própria ferramenta. Provavelmente a métrica de atrito da empresa mais honesta que
existe, porque ninguém a reporta espontaneamente.

---

## Como reproduzir a prova

```bash
# 1. Supabase local de pé + migration aplicada
npx supabase status
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f supabase/migrations/20260806190000_0133_fn_atrito_metrics.sql

# 2. App apontando para o LOCAL (nunca para a nuvem do .env.local)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon local> \
SUPABASE_SERVICE_ROLE_KEY=<service local> \
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
PORT=3100 pnpm build && ... pnpm start

# 3. Provar
npx tsx tests/sonda-atrito-tela.ts       # 4 pares medidos, screenshots
npx tsx tests/sonda-atrito-detalhe.ts    # as 4 correções de UI
npx tsx tests/sonda-overflow-controle.ts # controle do overflow pré-existente
```

Sempre confirme, antes de qualquer coisa, que o HTML servido referencia
`127.0.0.1:54321` e **nenhum** `*.supabase.co`.

---

## Próximo passo

Fase 1 está **fechada e provada**. As opções, em ordem de valor:

1. **Fase 2 — as réguas** (spec §5): "primeira resposta útil", janela de abandono
   em `channel_knobs` com tela (invariante 6), denominador definitivo.
2. **Regenerar `lib/database.types.ts`** — barato, tira a pendência de contrato.
3. **Issue do overflow mobile** — pré-existente, mas é primeira impressão num
   produto que se instala.
