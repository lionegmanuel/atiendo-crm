# CAL-W0-MOTOR — a sabotagem, colada

> Medido em 2026-08-26 13:43 -0300 no worktree
> `/Users/rafaelmelgaco/wt/cal-api`, branch `cal/w1-api`,
> SHA `8fc8591e`, árvore limpa antes de começar
> (`git status --porcelain` vazio). Cada bloco abaixo é a saída literal do
> `vitest`, não um resumo dela.
>
> **Esta é a SEGUNDA rodada.** A primeira mediu o SHA `a3b22591`; depois disso
> os arquivos mudaram (um tipo renomeado, um trecho de código morto removido).
> Sabotagem medida sobre um arquivo que mudou depois não prova o arquivo de
> agora — os números bateram, mas quem confere merece a rodada certa, não a
> promessa de que a diferença era cosmética.

Teste que não vermelhece não é rede de segurança, é decoração. Cada
mecanismo do motor foi quebrado de propósito, um de cada vez, e a
**contagem foi prevista antes de rodar** — prever obriga a entender o que
o teste vigia; conferir depois só confirma o que aconteceu.

## Base — antes de qualquer sabotagem
```console
$ npx vitest run tests/unit/agenda-fuso.test.ts tests/unit/agenda-horarios-livres.test.ts
Tests  31 passed (31)
```

## Sabotagem 1 — o buffer não infla o compromisso ocupado

A que o despacho pediu nominalmente. Sem a inflação, o vizinho que encosta no
compromisso volta a ser oferecido.

**Previsto: 1 falha.**

```console
Tests  1 failed | 30 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 1 failed)
  - × com 15min de buffer dos dois lados, o vizinho que ENCOSTA também sai
  - ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:179:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Sabotagem 2 — `windows` vazio volta a significar 24/7

A régua do roteamento aplicada à agenda — o erro mais provável de quem vier
"unificar as duas leituras" da mesma coluna. Oferece consulta às 3 da manhã.

**Previsto: 1 falha.**

```console
Tests  1 failed | 30 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 1 failed)
  - × dia sem janela publicada é ZERO horário — e não 24/7
  - ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:92:19
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Sabotagem 3 — fuso ingênuo: meia-noite UTC no lugar da conversão

Tratar hora de parede como se fosse UTC — o defeito clássico de agenda.

**Previsto: ~14 falhas.**

```console
Tests  15 failed | 16 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 15 failed)
  - × o almoço parte o dia em duas janelas, e não sobra horário às 12h
  - × o último slot precisa CABER na janela: 50min de duração não gera um às 17:30
  - × o intervalo da grade é independente da duração
  - × sem buffer, só o horário do compromisso some
  - × com 15min de buffer dos dois lados, o vizinho que ENCOSTA também sai
  - × compromisso que termina exatamente quando o slot começa NÃO bloqueia (sem buffer)
  - × o aviso mínimo come o começo do dia
  - × a janela de agendamento corta o futuro distante
  - × horário que já passou não aparece, mesmo sem aviso mínimo
  - × exceção com horário ABRE um sábado que a jornada não tem
  - × exceção com horário SUBSTITUI a jornada do dia, não soma a ela
  - × a virada do horário de verão não desloca a hora de parede da jornada
  - × atendente e consultante em fusos diferentes veem o MESMO instante
  - × a jornada de um fuso, o compromisso em UTC: o conflito é resolvido no instante
  - × `de` e `ate` recortam: meio dia consultado devolve meio dia de horários
  - ⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:116:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:132:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:144:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:162:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:179:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:193:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:208:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:224:73
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:238:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:272:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:288:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:314:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:336:30
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:356:44
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/15]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:386:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/15]⎯
```

## Sabotagem 4 — exceções de data ignoradas

O dia bloqueado volta a atender e o sábado aberto some.

**Previsto: 3 falhas.**

```console
Tests  3 failed | 28 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 3 failed)
  - × exceção que bloqueia o dia zera aquele dia, e só aquele
  - × exceção com horário ABRE um sábado que a jornada não tem
  - × exceção com horário SUBSTITUI a jornada do dia, não soma a ela
  - ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:257:30
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:272:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:288:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯
```

## Sabotagem 5 — o corte do aviso mínimo

⚠️ **Eu rotulei errado a minha própria sabotagem.** Previ uma falha, caíram
duas — e as duas estão certas: aquela linha carrega DUAS regras, o aviso mínimo
e o piso do "horário que já passou". Apagá-la derruba as duas. A previsão
errada é o dado: quem prevê pelo rótulo, e não pela linha, subestima o alcance.

**Previsto: 1 falha — e o medido corrige a previsão.**

```console
Tests  2 failed | 29 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 2 failed)
  - × o aviso mínimo come o começo do dia
  - × horário que já passou não aparece, mesmo sem aviso mínimo
  - ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:208:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:238:26
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```

## Sabotagem 6 — o corte da janela de agendamento

Marcar para daqui a um ano volta a ser possível.

**Previsto: 1 falha.**

```console
Tests  1 failed | 30 passed (31)
  - ❯ tests/unit/agenda-horarios-livres.test.ts (19 tests | 1 failed)
  - × a janela de agendamento corta o futuro distante
  - ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
  - ❯ tests/unit/agenda-horarios-livres.test.ts:223:30
  - ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Restaurado — a árvore volta ao commit, e o verde com ela
```console
$ git status --porcelain lib/agenda/    # (vazio)
Tests  31 passed (31)
```

---

# Segunda leva — a subtração da DECISÃO 11

Medido em 2026-08-26 ~14:35 -0300, SHA `d01cc63b`, mesmo worktree. A suíte do
motor tem 26 casos aqui (eram 19; a DECISÃO 11 trouxe 8 e converteu 1).

## S7 — a subtração não subtrai

**Previsto: 6 falhas. Medido: 6.**

```console
Tests  6 failed | 20 passed (26)
  × exceção que bloqueia o dia inteiro zera aquele dia, e só aquele
  × indisponível NO MEIO do dia tira só aquelas horas — o resto do dia continua
  × subtrair no meio parte a janela em DUAS, e a grade renasce em cada pedaço
  × disponível E indisponível no mesmo dia: a segunda subtrai o que a primeira abriu
  × bloqueio de dia inteiro VENCE exceção disponível do mesmo dia — decidido, não acidental
  × dois bloqueios no mesmo dia subtraem os dois, em qualquer ordem de cadastro
```

## S8 — a guarda de não-sobreposição removida

**Eu previ que era REDUNDANTE. A medição me contradisse.**

Meu raciocínio: com o corte fora da faixa, os dois `if` seguintes já produziriam
a faixa intacta, então a guarda não faria diferença. Errado — e o caso que me
escapou é o segundo corte:

> jornada 09:00–18:00, cortes `(15:00,16:00)` e depois `(10:00,11:00)`.
> Depois do primeiro, sobram `[09:00–15:00]` e `[16:00–18:00]`. O segundo corte
> está inteiramente ANTES da faixa `16:00–18:00` — e sem a guarda o ramo
> `corte.fim < faixa.fim` empurra `{11:00, 18:00}`, **reabrindo as 15h–16h que o
> primeiro corte tinha removido**.

```console
Tests  1 failed | 25 passed (26)
  × dois bloqueios no mesmo dia subtraem os dois, em qualquer ordem de cadastro
```

Quem pegou foi um teste que eu tinha escrito por completude, não por suspeita.

## S9 — o sinal da adjacência (`<=` vira `<` na guarda)

**Previsto pelo QAVivo como "um sinal trocado ali come um slot inteiro".
Medido: não come. 26/26 verdes.**

```console
Tests  26 passed (26)
```

Não é que o teste dele seja decorativo — ver S10. É que **a adjacência está
correta por construção**, não por escolha de sinal na guarda: quando o corte
encosta na faixa, os dois ramos do corpo (`corte.inicio > faixa.inicio` e
`corte.fim < faixa.fim`, ambos estritos) reconstroem a faixa idêntica. A guarda
chega antes e devolve a mesma coisa. As duas rotas concordam, então trocar o
sinal de uma não é observável — é o ramo redundante que engana a sabotagem.

## S10 — a guarda DESCARTA a faixa em vez de preservá-la

A sabotagem que os testes de adjacência **de fato** vigiam, e o modo de falha
realista de quem reescrever a função (esquecer o `resto.push(faixa)` antes do
`continue`).

**Medido: 3 falhas.**

```console
Tests  3 failed | 23 passed (26)
  × ADJACÊNCIA NÃO É SOBREPOSIÇÃO: bloqueio que termina às 12h não come o slot das 12h
  × bloqueio que encosta no FIM da janela também não a toca
  × dois bloqueios no mesmo dia subtraem os dois, em qualquer ordem de cadastro
```

## O que esta leva ensina, e não é sobre agenda

Três previsões, três desfechos diferentes: uma bateu (S7), uma me contradisse
(S8 — eu ia declarar redundante o que era essencial), e uma contradisse quem a
propôs (S9). **Nenhuma das três seria descoberta sem rodar.** Prever é o que
torna a medição informativa; nunca é o que a substitui.
