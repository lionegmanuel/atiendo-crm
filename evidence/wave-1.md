# Wave 1 — CORE 1 · a IA é dona do negócio · 2026-07-24

Evidência produzida por **@QAVivo** via `tests/capture-wave-1.ts` (navegador próprio,
viewport 1440×900, dev server 3020). Navegação **100% por clique**; toda atribuição foi
feita pelo menu do card, como um usuário faria.

**Rodada final — resultado: 11 PASS / 1 FALHA de 12 itens. A falha, nomeada:**

- **`5` — `axe-core: nested-interactive`.** Esperado 0 violações *serious*; obtido 11
  nós. **Herdada da `main`**, provada por git; aceita como dívida a pagar na Wave 2.

O item **`2.2` (separador segregando agentes dos humanos) fechou VERDE** — 0 separadores
entre o último humano e o primeiro agente, depois do refactor do seletor para lista única.

### Contra qual código estas capturas rodaram

| | |
|---|---|
| `HEAD` na captura | `c38cbe7` — *refactor(crm-vivo): seletor de responsável em lista única, com o avatar do card* |
| Cadeia | `c38cbe7` → `c7ce4ec` (helper `resolveOwnerPatch`) → `b247537` (CORE 1) → `3b4c193` (base) |
| Helper incluído? | `git merge-base --is-ancestor c7ce4ec HEAD` → **sim** |
| Working tree | `FilterBar.tsx`, `owner-patch.ts`, `_handler.ts` **limpos** — a captura equivale ao commit, não a um estado intermediário de disco |

O refactor **não** piorou o axe: `nested-interactive` seguia com **11 nós antes e 11 depois**.
Se o `OwnerBadge` dentro do `DropdownMenuItem` tivesse criado interativo aninhado, a
contagem teria subido. Não subiu.

### Declaração: uma asserção foi alterada nesta mesma rodada

Mudar teste e vê-lo ficar verde na mesma execução não pode passar calado.

- **O que mudou:** a detecção do item 2.2 identificava humano por texto **exato**
  (`^E2E Admin$`). Com o seletor em lista única, cada item passa a renderizar o
  `OwnerBadge` junto do nome — o texto virou `EAE2E Admin`. Com a regra antiga, nenhum
  humano seria encontrado e o 2.2 daria *"não deu para medir"*: **vermelho por engano**,
  culpando o autor por um acerto.
- **O que NÃO mudou:** o critério. Continua *"conte os `[role=separator]` **entre** o
  último humano e o primeiro agente, em ordem de DOM, e exija **zero**"*. O conserto foi
  no localizador que alimenta o critério, não no critério.

Os **4 cenários da §7 passaram**, mais os dois casos de tooltip e a paridade de avatar.

> Placar sempre colado ao item que faltou. Contagem sem o nome da falha é onde falha
> some — regra do regente, adotada.

### O item 2.2 nasceu de uma fraqueza deste próprio arquivo de teste

A asserção original do cenário 2 era: *"existe item humano **e** existe item agente no
mesmo menu"*. Um `DropdownMenuSeparator` segregando os agentes **passaria** por ela — ou
seja, o teste carimbaria exatamente o que o regente reprovou duas vezes na revisão manual.

O item 2.2 percorre o menu em **ordem de DOM**, localiza o último humano e o primeiro
agente, e conta os `[role="separator"]` **entre** eles. Zero = lista mesma de verdade.

Reprovação manual virou **gate automático**: quando o separador sair, o item fica verde
sozinho; se alguém reintroduzir daqui a três meses, ele reprova sem depender de ninguém
lembrar.

## Cenários da §7

| # | Cenário | Resultado | Evidência |
|---|---|---|---|
| 1 | Dono-agente do seed **com** versão publicada | **PASS** — `vazadoComAnel=true`, tooltip `Lia — AgendaPlus · v24`, sem emoji, sem badge "AI" | `wave-1-cenario-1-agente-com-versao.png` |
| 1.2 | Dono-agente **sem** versão publicada — borda que o regente pediu | **PASS** — tooltip `Bot Padrão E2E`, **sem ` · v` pendurado**, sem `undefined`/`null`/`NaN` | `wave-1-cenario-1-agente-sem-versao.png` |
| 1.3 | Agente é **par** do humano (§5): mesmo tamanho e peso | **PASS** — agente `24×24 peso 600` **==** humano `24×24 peso 600` | medido via `getBoundingClientRect` + `getComputedStyle` |
| 1.1 | Atribuir a agente **pela UI** | **PASS** — card vira vazado com anel, tooltip correto | `wave-1-cenario-1-card-agente.png` |
| 2 | Filtro "Responsável" lista agentes **junto** dos humanos | **PASS** — menu: `Todos · Sem responsável · Eu · E2E Admin · E2E Agent · Lia — AgendaPlus v24` | `wave-1-cenario-2-filtro-aberto.png` |
| 2.1 | Filtrar por `Lia — AgendaPlus` devolve **só** os leads dela | **PASS** — Rogério (Lia) visível; **Caio (outro agente) sumiu**; lead humano sumiu | `wave-1-cenario-2-filtrado-por-agente.png` |
| 3 | Transferir **agente→humano**, persiste após reload | **PASS** — após `reload()`: `preenchido=true`, `aria="Responsável: E2E Manager"` | `wave-1-cenario-3-dono-humano.png` |
| 3.1 | Transferir **humano→agente**, persiste após reload | **PASS** — após `reload()`: `vazadoComAnel=true`, tooltip `Lia — AgendaPlus · v24` | `wave-1-cenario-3-dono-agente.png` |
| 4 | `viewer` **não** consegue reatribuir | **PASS** — o botão de ações **nem existe** para o viewer | `wave-1-cenario-4-viewer.png` |
| 6 | Fixture devolvido a "Sem responsável" **pela própria UI** | **PASS** | — |

> O cenário 2.1 discrimina **entre agentes**, não só agente-vs-humano: filtrar pela Lia
> esconde o lead do `Bot Padrão E2E`. Filtro que só separasse "IA" de "humano" passaria
> num teste mais frouxo e estaria errado.

## Dois defeitos MEUS de instrumentação, corrigidos no caminho

Nenhum era do produto — mas os dois produziriam resultado enganoso:

1. **`getByRole("heading")` parou de resolver.** O card é `role="button"` (drag handle do
   dnd) e, pela regra ARIA de *children presentational*, o `<h3>` de dentro **perde** o
   papel de heading assim que o dnd hidrata. O locator funcionava por **corrida**:
   resolvia antes da hidratação. Trocado por ancoragem no container `[data-rfd-draggable-id]`.
2. **`networkidle` não bastava.** O board monta os cards depois; o script chegou a ver
   **0 cards** e ia acusar board vazio. Trocado por espera determinística pelo primeiro
   card — nunca por `sleep` fixo, que só transforma o erro em intermitência.

## axe-core — a única falha, e por que ela não é da Wave 1

`serious: nested-interactive` — 11 nós, um por card.

O nó acusado é o **próprio container arrastável**: `div[role="button"]` do
`@hello-pangea/dnd` contendo o botão `Ações do lead`. Controle interativo dentro de
controle interativo.

**Prova de que é herdado, não introduzido:**

1. `git cat-file -e origin/main:components/kanban/KanbanCardActions.tsx` → o arquivo **já
   existia** na base;
2. `git show origin/main:components/kanban/KanbanCard.tsx` → o `dragHandleProps`
   (`role="button"`) e o `<KanbanCardActions>` dentro dele **já conviviam** na `main`;
3. `git diff origin/main -- components/kanban/KanbanCard.tsx | grep -E '^[+-].*(button|onClick|role=|tabIndex)'` →
   **nenhuma linha**. A Wave 1 não adicionou um único elemento interativo ao card.

Logo o critério da §7 ("axe sem violação **nova**") está **cumprido**.

**Mas é dívida real, não desculpa:** para quem navega por teclado, cada card é um botão
cheio de botões. A Wave 2 reconstrói o card — é ali que isso se paga, de graça.

## Teste do metro — honesto

Olhando `wave-1-board-com-agente.png` a um metro:

- **Dono: agora dá.** Círculo **vazado com anel** (agente) contra **disco preenchido**
  (humano), mesmo diâmetro e mesma posição. A distinção é **geométrica**, então
  sobrevive ao daltonismo. Nenhum emoji, nenhum badge colorido, nenhum gradiente — a §5
  foi respeitada à risca.
- **Ressalva:** o disco humano tem contraste baixo (verde claro sobre branco). A um metro
  ambos leem como "círculo claro"; o que separa é a **borda**, não o preenchimento.
  Funciona, mas é a leitura mais frágil do card. Vale endurecer na Wave 2.
- **Quem pede atenção: continua não dando.** "Bruno Tavares" (150h parado) e
  "Helena Marques" (480h parada e sem dono) seguem idênticos aos saudáveis. Inalterado
  em relação à Wave 0 — é o buraco que a Wave 2 e o CORE 5 fecham.

## Correção de um achado meu que estava ERRADO

Na primeira rodada eu registrei que dois leads (`Rogério Paiva`, `Caio Ribeiro`) estavam
com dono-agente por **deriva de fixture**, vinda de teste manual.

**Estava errado, nas duas pontas:**

1. Os donos-agente são **seed intencional** — o regente estendeu `scripts/seed-crm-vivo.ts`
   com o bloco da Wave 1, resolvendo o agente **por nome** (não por uuid, para sobreviver
   a um clone).
2. Aquele seed **já escreve o trio** `owner_kind` / `owner_user_id` / `owner_agent_id` no
   mesmo UPDATE (linhas 332-333) **e já checa o `error`** da resposta (linhas 353-354).

Eu havia lido a versão anterior do arquivo. Conclusão errada, registrada e desfeita.

**O que do achado SOBREVIVE:** `scripts/seed-e2e-kanban.ts` continua sem checar o `error`
do UPDATE (linhas 58-62) — e foi ele, não o outro, que causou o vermelho na linha de base
da Wave 0. Esse conserto continua de pé.
