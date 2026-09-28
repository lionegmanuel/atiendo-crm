# ADR-0003 — Perfil declarativo v2: portas nomeadas, e o metadado de loja no catálogo

- **Status:** aceito em 2026-09-17 pelo dono do produto (resposta **C** da escolha 4 do
  `DEC-007 — Marketplace — quatro escolhas`)
- **Data:** 2026-09-17
- **Contexto medido em:** `8ad4e2572` (topo de `origin/main`)
- **Lei que muda quando aceita:** [`docs/doctrine/extensoes.md`](../doctrine/extensoes.md) — a linha
  "Pacote JSON estrito com cards de orientação e a capacidade `tasks.open`" da tabela do que existe
- **Investigações que a sustentam:** [`docs/research/marketplace/`](../research/marketplace/)

---

## Contexto

O perfil declarativo v1 entrou na `main` em 17/09/2026 com o ciclo de vida completo — admissão de
catálogo, instalação, ativação por organização, configuração, atualização, desfazer, remoção e
recibos duráveis. O que ele **carrega** é que ficou mínimo, e a medição é direta:

| Fato | Comando que o produziu |
|---|---|
| Uma única permissão, declarada como **tupla literal** de um elemento | `grep -n "permissionsSchema" lib/extensions/manifest.ts` → `z.tuple([z.literal("navigation.tasks")])` |
| Uma única capacidade de ação | `grep -n 'capability' lib/extensions/manifest.ts` → `z.literal("tasks.open")` |
| Nenhum pacote publicado no repositório | `grep -rl --include='*.json' '"declarative"' . \| wc -l` → `0` |
| O manifesto não tem campo de autoria, site, etiqueta ou imagem | leitura de `ExtensionManifest`, que é `.strict()` |

A consequência de produto é que **todo pacote é o mesmo pacote com outro texto**: um cartão de
orientação e um botão que abre Tarefas. Inaugurar uma loja assim contraria o não-negociável 11
por outro caminho — não por prometer o que não existe, mas por convidar alguém a criar algo que
não tem como ser diferente do vizinho.

### O cadeado que não pode ser perdido

Hoje o pacote **nunca informa um endereço**. Ele nomeia uma ação, e o servidor traduz esse nome
num destino constante escrito no código, que a tela ainda reconfere:

- `app/api/v1/extensions/[id]/open/route.ts:44` — `return ok({ href: "/app/tasks" })`
- `components/extensions/ExtensionGuide.tsx:149` — recusa o que não for exatamente esse valor

Três testes cobrem esse comportamento (`components/extensions/ExtensionGuide.test.tsx:79,96`,
`lib/extensions/context-routes.test.ts:168`, `tests/e2e/extensoes-declarativas.spec.ts:840`). Eles
afirmam **o valor de hoje**, não a regra. Quem ampliasse a capacidade atualizaria os três de
boa-fé, e a propriedade sumiria sem nenhum vermelho — e a saída preguiçosa (`href.startsWith("/app/")`)
alcançaria `/app/settings/api-tokens` e `/app/ai/credentials`.

### O que o banco impõe

A migration `0271` valida o manifesto **no banco**, e a validação é de conjunto fechado:

```
0271:356  not (p_manifest ?& array['format_version',…,'contributions'])
0271:357  p_manifest - array['format_version',…,'contributions'] <> '{}'::jsonb
```

Ou seja: **qualquer chave nova no topo do manifesto exige migration**. O conteúdo de cada chave,
porém, é validado só no TypeScript. Isso decide o desenho abaixo mais do que qualquer preferência.

---

## Decisões

### D1 — Capacidade continua sendo um NOME, resolvido por um mapa constante no servidor

O vocabulário deixa de ter um elemento e passa a ter uma **lista fechada**. O pacote continua
escolhendo apenas entre nomes que nós publicamos; ele nunca fornece, compõe ou influencia um
endereço. O mapa `capacidade → destino` é uma constante do código do host, exaustiva por tipo.

Entram as portas de **trabalho do dia**, todas já sujeitas à autorização normal de quem clica:

| Capacidade | Abre |
|---|---|
| `tasks.open` | Tarefas (já existia) |
| `inbox.open` | Conversas |
| `kanban.open` | Funil |
| `contacts.open` | Contatos |
| `agenda.open` | Agenda |
| `radar.open` | Radar |

**Não entram, e a recusa é explícita:** qualquer coisa sob `/app/settings`, as credenciais e
provedores de IA, os webhooks, as chaves de API e toda a área de administração da instalação.
A régua é: uma extensão orienta o trabalho, nunca leva alguém para onde se guarda segredo.

### D2 — A permissão deixa de ser tupla e vira conjunto declarado, com verificação de cobertura

`permissions` passa a ser uma lista não vazia, sem repetição, de um enum fechado
(`navigation.tasks`, `navigation.inbox`, …). A compatibilidade exige que **toda capacidade usada
nos cartões esteja coberta por uma permissão declarada** — pacote que usa `inbox.open` sem
declarar `navigation.inbox` é recusado na instalação, na ativação e na leitura.

Isso preserva o princípio do não-negociável 2: a extensão **pede** capacidade, e o que ela pede
fica legível na tela antes de alguém aceitar.

### D3 — O metadado de loja mora no CATÁLOGO, não no pacote

A vitrine precisa mostrar autoria, site do projeto e etiquetas. **Nada disso entra no manifesto**,
por duas razões que se somam:

1. A spec v1 recusa URLs no pacote, e essa recusa é boa: um endereço clicável dentro de um pacote
   de terceiro, renderizado na tela de quem instalou, é uma porta de engano.
2. O manifesto é validado por conjunto fechado no banco — cada campo novo é uma migration.

Então os campos de loja vão para o `CatalogEntry`, que é **o artefato que nós revisamos** antes de
publicar. O pacote descreve o que ele faz; o catálogo descreve de quem ele é. A autoria passa a
ser afirmada por quem revisou, não por quem enviou — que é exatamente a propriedade que uma loja
precisa ter.

Campos novos do `CatalogEntry`: `publisher_label`, `homepage`, `repository`, `tags[]`,
`published_at`. Eles não atravessam a comparação byte-a-byte entre pacote e catálogo.

### D4 — `host_api` sobe para 2, e a janela fechada ganha aviso em vez de silêncio

`HOST_API_VERSION` passa a 2. Pacotes v1 declaram `{min:1,max:1}` e, pela semântica de janela
declarada pelo autor, tornam-se incompatíveis — o que está **correto**: o autor disse até onde
garantia.

O que muda é a saída. Hoje um guia ativo incompatível sai do hub com um registro técnico e nada
mais (`lib/extensions/service.ts:583-592`). Isso foi deliberado — antes, um guia problemático
derrubava a lista inteira —, mas quem **usa** a organização só vê o cartão sumir. Passa a existir
um aviso na própria tela, com o caminho para a gestão. O registro técnico continua.

### D5 — O que a ampliação NÃO inclui

| Recusado agora | Por quê | Reconsideraríamos se |
|---|---|---|
| **Pacote contribuir instrução ao agente de IA** | o motor de instruções expande referências que caminham pelo conteúdo da sessão; deixar o pacote escolher o caminho é leitura do que não é dele. Duas investigações independentes apontaram o mesmo risco | houver desenho próprio, com escopo de leitura fechado e prova |
| **Endereço livre, ou qualquer prefixo** | alcançaria segredo com todos os testes verdes | nunca |
| **Imagem ou captura de tela no pacote** | URL de asset é recusada pela spec, e o ícone da lista fechada resolve a vitrine | houver hospedagem própria de asset revisado |
| **Tela, tabela, menu ou rota vindos do pacote** | é o marco de módulo nativo, decidido na ADR-0002 e ainda não construído | a ADR-0002 ser implementada |
| **Contador de download no pacote ou na VPS** | telemetria pede decisão própria (DEC-004 §3); contador grava IP por default | decisão específica, com campos e retenção publicados |

---

## Consequências

- **Quem instala:** vê, antes de aceitar, a lista de portas que a extensão vai usar.
- **Quem cria:** ganha um vocabulário com o qual dois pacotes podem ser realmente diferentes.
- **Quem opera:** um pacote da versão anterior não some calado; a tela diz o que houve.
- **Schema:** nenhuma migration é necessária para D1, D2 e D4 — o banco valida as chaves de topo,
  e nenhuma chave de topo é criada. D3 não toca o manifesto. **Esta ADR não altera o schema.**
- **Rede de testes:** entra a guarda que faltava — um teste de **propriedade** afirmando que
  nenhum valor vindo do manifesto alcança o destino, e que todo destino sai do mapa constante.

## O que esta ADR não decide

- O conteúdo da loja e quem revisa cada envio (escolha 3 do DEC-007, respondida **A**).
- Onde a página pública mora (escolha 1, respondida **A**; ela vive no repositório do site).
- O comando do kit (escolha 2, respondida **B**), que é cliente da porta HTTP e não muda o contrato.
