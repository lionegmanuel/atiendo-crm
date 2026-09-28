# Prova em tela da Agenda — pelo maestro, depois dos consertos

**Régua:** worktree `/Users/rafaelmelgaco/wt/cal-integra` (meu), `integra/w0`
@ `90c6bb1f`, árvore limpa. App de **produção** (`next build` + `next start`) na
3012, contra o stack isolado `deskcomm-cal` (54421). Login pelo formulário,
navegação por clique.

## Os dois defeitos que eu tinha achado — MORTOS

### DEFEITO 1 · o botão "Novo agendamento" estava inerte

```
ANTES                              DEPOIS
temOnClick: false                  disabled: true
não estava disabled                motivo VISÍVEL em texto:
252 nós antes → 252 depois         "Disponível quando a agenda estiver conectada"
(clique não fazia nada)            229 nós antes → 229 depois (não clicável)
```

Deixou de ser **controle decorativo** e passou a ser **indisponibilidade
declarada**. E o motivo está em **texto ao lado**, não no `title` — decisão do
VPS que foi além da minha instrução: *atributo de hover não existe para quem usa
toque, e o dono de clínica está no celular*.

### DEFEITO 2 · a preposição capitalizada em pt-br

```
ANTES     "23 De Ago — 29 De Ago"          (e "Terça-Feira, 25 De Ago" na coluna)
DEPOIS    "23 de ago — 29 de ago"
varredura por  /\d\s+De\s+\w|-Feira/  →  false
```

Eu reportei **uma** instância; ele foi procurar a **classe** e eram **quatro** —
duas delas visíveis no screenshot que ele mesmo tinha olhado uma hora antes.

## O que exercitei agora, e passou

As três visões trocam por clique, e o rótulo do período muda certo em cada uma —
**com a capitalização correta nas três**:

```
Dia     →  "26 de agosto"
Semana  →  "23 de ago — 29 de ago"
Mês     →  "Agosto de 2026"
```

## O que continua NÃO provado, e por quê

Marcar, remarcar, cancelar, filtro por pessoa com dado real e histórico
**dependem da frente 1** (API), que ainda não expôs rota. A grade não foi
exercitada com dado real pelo mesmo motivo.

Pela **DECISÃO 21**, isso não bloqueia o fechamento da frente 1 — mas a entrega
inteira só fecha quando a spec da frente 2 provar esse fluxo em tela.
