# Prova pela tela — Templates do WhatsApp (Fase 3a, Task 5)

Jornada em `tests/journeys/templates-screen.spec.ts`, 3 casos, login real com TOTP,
build de produção na 3007. **3 passed em 15,4s.**

Re-rodar:
`E2E_PORT=3007 CANAIS_EVIDENCE_DIR=evidence/canais/fase3a/tela pnpm exec playwright test --config tests/journeys/playwright.config.ts templates-screen`

| Passo | Evidência | O que prova |
|---|---|---|
| 1 | [hub de configurações](evidence/canais/fase3a/tela/01-hub-settings.png) | O card **Templates do WhatsApp** existe no hub de configurações — a tela é alcançável clicando, não só por URL decorada. |
| 2 | [a tela](evidence/canais/fase3a/tela/02-tela-templates.png) | A tela abre com o espelho da WABA e a contagem de templates. |
| 3 | [parâmetros derivados](evidence/canais/fase3a/tela/03-parametros-derivados.png) | **O caso central.** O corpo aparece uma vez com todos os `{{n}}` destacados no lugar onde vivem; o header de mídia aparece como parâmetro **mesmo sem `{{n}}` nenhum**; e o carrossel mostra `card 1 › cabeçalho` / `card 2 › cabeçalho`. É o contrato derivado, visível. |
| 4 | [sync executado](evidence/canais/fase3a/tela/04-sync-executado.png) | O botão **Sincronizar com a Meta** fez o que promete: `POST` 200 contra a Graph API real e toast com as contagens. |

## Dois defeitos que só apareceram OLHANDO

Os 3 casos passavam antes destes consertos — ambos sobreviviam a `toContainText`.

1. **`Recusado: NONE` num template APROVADO.** A linha fora gravada pelo webhook
   antes do conserto da normalização. O conserto impede escritas novas e não limpa
   as velhas; um clone atualizado carregaria o mesmo lixo. Passou a normalizar
   também na **leitura** (`app/api/v1/channels/templates/route.ts`).
2. **O preview repetia o corpo inteiro a cada parâmetro** — cada linha destacava o
   seu e deixava o vizinho cru (`Ola (1), seu atendimento {{2}}…` seguido de
   `Ola {{1}}, seu atendimento (2)…`). Correto e ilegível. Agora o texto sai uma
   vez só, com todos marcados.

A doutrina de QA Visual não é sobre automatizar o clique. É sobre alguém precisar ver.
