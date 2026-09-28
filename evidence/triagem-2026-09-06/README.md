# QA visual da rodada de triagem de 06/09/2026

Prova de tela dos PRs **#597** (@JowaniOrantes), **#599** (@rafaelcesardev),
**#600** (@JowaniOrantes) e das recuperações **#595/#596** (@maugarciasa), todos
**mergeados juntos numa branch de integração** e exercitados de uma vez — o que
nenhum CI faz, porque cada PR é testado sozinho.

## O ambiente

O do CI, não uma aproximação: Supabase local **pg17**, `supabase start` **sem a
cadeia de migrations**, `supabase/baseline.sql` aplicado com `ON_ERROR_STOP=1`
(o mesmo arquivo que o `install.sh` do kit aplica), Realtime reiniciado depois do
baseline, `pnpm e2e:env` + `pnpm e2e:build` e `next start` em produção.

O controle do `e2e-build.sh` confirmou, na saída, que o bundle do browser aponta
para `127.0.0.1:54321` — sem ele, "o teste passou" pode significar "o cliente
falou com o banco de produção".

## O que cada arquivo prova

| arquivo | o que prova |
|---|---|
| `597-resumo-da-importacao.png` | A importação por planilha volta a funcionar. Na `main` de 06/09 ela devolvia `422 "Escolha o funil e a etapa de destino."` e **zero leads**, em três releases seguidas — o `ImportarLeads.tsx` é o único chamador da rota e nunca manda `stage_id`. |
| `597-importou-em-funil-mal-ordenado.png` | O bloqueador que a triagem mediu: num funil em que a etapa de **ganho** foi arrastada para a primeira coluna, a planilha inteira nascia como negócio já fechado (o trigger `fn_crm_lead_close_on_stage` sobrescreve o `status: "open"` do handler). |
| `597-card-na-coluna-aberta.png` | O mesmo lead, depois do conserto, no quadro — na primeira etapa **aberta**. |
| `599-canal-existente-segue-aberto.png` | A promessa mais cara do #599: um canal que já existia (metadata sem `ai_gate`) **não acorda mudo** depois da atualização. O selo no cartão diz "IA aberta ao público". Se acordasse mudo, toda instalação existente perderia o atendimento automático no `update.sh`. |
| `599-em-modo-de-teste-com-um-numero.png` | Modo de teste ligado pela tela, com a contagem no cartão. Foi **olhando esta tela** que apareceu "1 **números** de teste autorizados" — concordância que nenhum teste pega, consertada no mesmo PR. |
| `599-confirmacao-de-liberacao.png` | Abrir ao público exige confirmação explícita, e a lista de teste é preservada para uma rodada futura. |

## Discriminância — a parte que impede isto de ser teatro

A spec `tests/e2e/triagem-set06-etapa-ganha.spec.ts` foi **sabotada** com uma
previsão escrita antes de rodar: *remover `.eq("is_won", false).eq("is_lost",
false)` da rota reprova 1 caso, em "caiu na etapa de GANHO"; a spec do
contribuidor (funil bem ordenado) segue verde.*

Observado, depois de reconstruir a imagem com a sabotagem aplicada:

```
✓  importar-leads-planilha.spec.ts       (funil bem ordenado — verde, como previsto)
✘  triagem-set06-etapa-ganha.spec.ts     Error: caiu na etapa de GANHO — o conserto não está valendo
1 failed / 1 passed
```

Fonte restaurado em seguida (`git diff --numstat` vazio).

## O que o QA visual achou e nenhum gate acharia

1. **"1 números de teste autorizados"** — concordância no cartão do canal, no
   caso mais comum enquanto o operador configura. E o caso de **zero** mostrava
   um "0" em vez de dizer que a IA não responde a ninguém ali.
2. **A regressão do #607.** Rodar `system-update.spec.ts` sobre a integração
   reprovou o caso *"quando a atualização falha, a tela nomeia a versão certa"*:
   a regra recuperada do @maugarciasa ("quem gravou depois vence") consertava o
   rollback de oito dias e **quebrava** o rollback recém-ocorrido, porque nos
   dois o host reporta depois do run. O que separa é a **versão** reportada, não
   o relógio. Os 7 casos de `system-update` ficaram verdes depois do refinamento.

## Placar final da bateria

```
11 specs · 11 verdes
i18n-espanhol-na-tela · importar-leads-planilha · triagem-set06-etapa-ganha
triagem-set06-pre-go-live · system-update (7 casos)
```

## Uma armadilha, medida duas vezes

As specs rodam **em paralelo**, e uma fixture com nome que existe no dicionário
contamina o vizinho: uma etapa chamada `"Novo"` aparece em `/app/metrics` e faz o
guardião do espanhol acusar "texto em português não traduzido". Fixture de QA usa
nome com sufixo único e **nenhuma palavra que esteja no dicionário**.
