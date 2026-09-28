# A cadeia `before_send` vira v5 — e só o trace muda

Fase 4, Task 3. Medido contra o banco local com um turno REAL de IA
(`scripts/provoke-agent-turn.ts`), worker fresco.

## O diff que é a prova

```
$ diff evidence/canais/baseline/gates.csv evidence/canais/fase4/gates.csv
4a5
> messaging_window,skipped,not_applicable
```

**Uma linha acrescentada. Zero linhas alteradas.** Os oito gates originais mantêm
veredito e ordem; o gate novo entra entre `pacing` e `spinning` e registra
`skipped` porque o canal do turno é de auto-restrição (WAHA fala livre a qualquer
hora — não tem janela).

A cadeia em produção, lida do `before_send_traces`:

```
stop              -> pass
lgpd              -> pass
pacing            -> pass
messaging_window  -> skipped (not_applicable)
spinning          -> pass
promise           -> pass
semantic_promise  -> pass
case_promise      -> pass
disclosure        -> pass
```

## Por que a baseline v4 NÃO foi sobrescrita

`evidence/canais/baseline/gates.csv` provou o que precisava provar: que as Fases 0–2
não mudaram comportamento nenhum. Sobrescrevê-la apagaria essa prova.

A referência para daqui em diante é este arquivo (`evidence/canais/fase4/gates.csv`,
9 linhas). O `diff` acima é a ponte entre as duas, e o motivo de a diferença ser
legítima está escrito aqui — em vez de alguém no futuro achar o diff sujo e
"consertar".

**Isto é mudança de trace, não de comportamento.** Nenhuma mensagem muda de destino:
o gate só arma em canal que exige template fora da janela, e nenhuma sessão do
ambiente é desse tipo.

## Achado do caminho: o banco local estava atrás do código

O primeiro turno provocado morreu com `column v.manifest does not exist`, depois de
5 tentativas. Não era o gate: o merge com a `main` (79 commits) trouxe as migrations
`0068_skills_marketplace`, `0069_seed_platform_skills`, `0085_intent_router` e
`0086_knowledge_searches`, e o banco local — aplicado a partir do `baseline.sql`
ANTES do merge — não as tinha. Aplicadas, o turno passou.

Lição de medição: código novo com banco velho falha por motivo que **parece** ser do
código novo. Vale conferir o schema antes de acusar a mudança da vez.
