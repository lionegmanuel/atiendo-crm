# A tool `send_template` fecha o ciclo — e o que nela NÃO tem cobertura

Fase 4, Task 5. O caminho completo, do veto até o template saindo:

```
gate messaging_window veta texto livre
  → reason nomeia a ferramenta: "use send_template"
    → tool renderiza o texto que o lead vai ler
      → runBeforeSend({ isTemplate: true, body: renderizado })
        → stop / lgpd / pacing / promise / spinning / disclosure CONTINUAM valendo
          → channel.send({ template: {...} })
            → POST /api/v1/messages type=template
              → sendTemplateForSession → sendTemplate → Graph API
```

## Duas decisões que evitam bypass

1. **O `body` da cadeia é o template RENDERIZADO**, não o nome dele. Os gates de
   promessa, spinning e disclosure avaliam exatamente o que o contato vai ler — sem
   isso, "usar template" seria a forma de a IA prometer o que a tabela proíbe.
2. **`isTemplate` vive dentro de `messagingWindow`**, não num campo de topo do
   contexto. Um `ctx.isTemplate` global convidaria outros gates a consultá-lo, e o
   bypass voltaria pela porta dos fundos. Há teste assertando que o topo do contexto
   não tem esse campo.

## Idempotência: a chave continua sendo o texto

O `body` renderizado é o que entra no hash de idempotência do ledger `(job_id, seq)`.
Trocar a chave por "nome do template" faria dois envios com **valores diferentes**
colidirem, e o segundo viraria `already_sent` sem ter saído — mensagem perdida em
silêncio, no caminho que mais custa.

## ⚠️ O que NÃO tem cobertura, medido por sabotagem

Removi o gating por capability (`delete rawTools.send_template`) e **nenhum teste
vermelheceu**. O fio dentro de `lib/agent-engine/agent/inbound-turn.ts` não é
coberto.

O que **está** testado:
- a decisão (`capabilitiesOf(provider).requiresTemplates`) — matriz de capabilities
- o gate e o reconhecimento de template — 10 casos
- a renderização — 6 casos
- a tradução do desfecho — 6 casos
- `sendTemplate` — 8 casos + envio real
- o handler com `type: template` — 13 casos + 2 sabotagens
- o adapter Meta — 12 casos + envio real

O que **não** está: a montagem da tool no turno e o gating. Testá-los exige um turno
completo (pool, LLM, job), que é por que os testes daquele arquivo vivem em
`tests/invariants/` com Postgres real.

Declarado em vez de escondido. Sabotagem que passa verde é a única forma de descobrir
que uma linha não tem quem a vigie — e é dívida nomeada, não lacuna anônima.
