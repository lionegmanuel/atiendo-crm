# State

**Updated:** 2026-08-22

## Preferences

- Spec-driven TLC: Specify → Design → Tasks antes de Execute nesta feature.

## Decisions

- CRM automação ≠ follow-up: relógio de evento vs `next_eval_at`. Canvas visual pode copiar Sage/React Flow; schema e motor não se misturam.
- P1 = compile para colunas v1 (sem migration). P2 = `graph jsonb` + walk ramificado.
- Cadeia regra→regra (depth >1) continua fora (v1 2026-07-17).

## Blockers

- Nenhum. Spec/design/tasks em Draft até o usuário aprovar.

## Todos

- Aprovar spec (P2 no MVP ou só canvas 1:1).
- Execute só depois do OK.

## Deferred

- Round-robin assign_owner, novos gatilhos, wait/IA na automação, form hospedado.
