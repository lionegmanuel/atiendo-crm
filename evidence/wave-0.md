# Wave 0 — CRMV0 · linha de base visual · 2026-07-24

Evidência produzida por **@QAVivo**. O handoff oficial é escrito pelo regente (§10);
este arquivo é o índice da evidência, para ser citado lá.

## Como a evidência foi produzida

`tests/capture-wave-0.ts` — navegador próprio (`chromium.launch`), viewport
**1440×900**, contra o dev server da **3020**.

Caminho percorrido, **inteiro por clique**, como um usuário:

1. `/login` → digita e-mail e senha do **manager** (`e2e-manager@deskcomm.test`);
2. cai em `/app/inbox` → clica em **Kanban** no menu lateral;
3. na lista de pipelines, clica na linha **"CRM Vivo — Clínica"**;
4. board carregado → capturas.

O script também cobre o **admin** (`E2E_USER=admin`), que tem MFA TOTP forçado: o
código de 6 dígitos é digitado dígito a dígito no campo de slots — `fill` não dispara
os handlers e o botão fica desabilitado; o formulário auto-submete no sexto dígito.

Nenhuma navegação por URL direta; nenhuma asserção de API ou de banco foi tratada
como prova.

## Capturas

| Arquivo | O que mostra |
|---|---|
| `wave-0-board-antes.png` | Board inteiro (fullPage, 1440×900), 10 leads em 4 colunas — **a linha de base da Wave 2** |
| `wave-0-card-antes.png` | Close do card "Clínica Vitalis — implantes" |
| `wave-0-card-titulo-longo-antes.png` | Close do card de título de 123 caracteres |
| `wave-0-navegacao.png` | Lista de pipelines — o board alcançável por clique |
| `wave-0-board-antes-full.png` | Captura anterior (viewport 1600×1000), mantida como referência |

## Medidas (por ferramenta, não a olho)

Altura de cada card no board, em px:

| Altura | Card |
|---:|---|
| 116 | Marina Costa — clareamento |
| 119 | Rogério Paiva — avaliação inicial |
| 143 | Clínica Vitalis — implantes |
| 143 | Família Andrade — 4 tratamentos |
| 143 | Bruno Tavares — protocolo superior |
| 143 | Caio Ribeiro — dor de dente |
| 143 | Patrícia Nunes — prótese fixa |
| 145 | Helena Marques — ortodontia adulto |
| 154 | Grupo Odonto Sul — contrato corporativo |
| 154 | Clínica Vitalis — pacote completo… (título de 123 chars) |

**min 116 · max 154 · variação 38px em 10 cards.**

O mais alto (154px) é o de **título de 2 linhas**; o mais baixo (116px) é o **sem tag**.
Hoje a altura é função do conteúdo — exatamente o que a Lei B da §5 proíbe.

Este é o número que a Wave 2 tem de zerar: a Lei B da §5 exige **altura constante**.
Hoje o card cresce com o dado — título de 2 linhas soma altura, valor ausente subtrai.

## Matriz do seed, conferida no banco

`scripts/seed-crm-vivo.ts` rodado **3× seguidas**: mesmos ids, mesmo board — idempotente.

| Requisito | Estado | Evidência |
|---|---|---|
| mínimo 8 leads | PASS | 10 leads |
| espalhados por estágios | PASS | 4 dos 6 estágios ocupados |
| lead com dono humano | PASS | 8 com dono |
| lead SEM dono | PASS | 2 sem dono |
| lead com valor nulo | PASS | "Rogério Paiva — avaliação inicial" |
| título ≥ 120 caracteres | PASS | 123 chars |
| lead com 8 tags | PASS | "Família Andrade — 4 tratamentos" |
| esfriando (estoura `expected_duration_hours`) | PASS | Bruno Tavares 150h > 72h · Helena Marques 480h > 96h · Patrícia Nunes 60h > 48h |
| estágios com janela declarada | PASS | 24h / 48h / 72h / 96h |
| não colide com `seed-e2e-kanban.ts` | PASS | pipeline e títulos próprios |

## Observações da linha de base (não são bugs — são o "antes")

1. **Altura não é constante** (38px de variação) — alvo da Wave 2.
2. **Tags estão no card** ("primeira-consulta", "implante", `+5`) — a §5 manda ir para
   hover, deixando só **uma** tag canônica como ponto de 6px.
3. **Valor nulo não quebra** — o card de "Rogério Paiva" simplesmente omite a linha de
   valor; não aparece `R$ 0` nem `NaN`. Mas é *essa omissão* que encurta o card (119px).
4. **Título de 123 caracteres não quebra o layout** — trunca em 2 linhas com reticências.
5. **Nada no card diz quem está esfriando.** Bruno Tavares (150h) e Helena Marques
   (480h, e sem dono) parecem iguais aos demais. No teste do metro, hoje dá para ver
   *quem é o dono*, mas **não** *quais cards pedem atenção* — é a lacuna que o slot
   (Wave 2) e o CORE 5 (Wave 7) existem para fechar.
6. **Console: HTTP 429** (`Too Many Requests`) em 1–2 recursos durante a carga do board.
   Não impediu a renderização. Registrado para observação — se reaparecer sob os e2e,
   vira achado de rate limit.

## O que ficou para trás

- **Entrega 1 não foi escrita por mim.** `scripts/seed-crm-vivo.ts` já existia quando
  fui gravar (mtime 18:06). Não sobrescrevi — a regra 1 da §10 manda parar e falar.
  Meu papel virou **verificar** o seed, não reescrevê-lo.
- **Densidade "Compacta" não foi exercitada** — é cenário da Wave 2, fora deste despacho.
- **`axe-core` não rodou nesta wave** — a Wave 0 não altera UI; entra na primeira wave
  que tocar o card.
