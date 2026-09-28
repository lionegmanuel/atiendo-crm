# Handoffs arquivados

Toda a documentação de **processo** do DeskcommCRM está nesta pasta. Handoff é o
diário de um épico: o que foi tentado, o que foi medido, o que ficou aberto. É
documentação de *processo*, não contrato de produto — **trate como estado, não
como verdade**. O que é verdade está em [`../index.md`](../index.md) e no
código.

## A convenção

A raiz do repositório **não** guarda mais `HANDOFF*.md`. Todo handoff vive aqui,
encerrado ou não. Até setembro de 2026 valia a regra anterior ("épico vivo
mantém o handoff na raiz, épico encerrado vai para cá"), e ela falhou: 12
arquivos se acumularam na raiz, a lista da convenção citava 3 deles, e quatro
carregavam identificador de produção num repositório público. Um handoff de
épico encerrado na raiz vira documentação de produto sem revisão — a raiz é o
diretório que o mundo lê primeiro.

O gate que impede a volta é
[`tests/unit/handoff-na-raiz-nao-volta.test.ts`](../../tests/unit/handoff-na-raiz-nao-volta.test.ts):
ele reprova `HANDOFF*` na raiz **e** reprova identificador de produção nos
arquivos desta pasta. Estar nesta pasta não torna o arquivo seguro — o conteúdo
continua sendo lido.

## Sobre dado de cliente

Quando um handoff registra uma reprodução real, o registro vai **pseudonimizado**:
o **formato** do identificador sobrevive (é o que mantém o defeito
reproduzível e é o que dá ao gate o que casar), o **valor** não. Um
`remoteJidAlt` sintético, um UUID-nil, um `@exemplo-ficcao.invalid`. Apagar a
linha inteira também não é a resposta: o defeito documentado é a evidência do
produto, e perdê-lo é perder a única memória de por que a correção existe.

A pseudonimização é deliberadamente **visível**: quem lê o arquivo vê o rótulo e
sabe que o valor não está ali. Dado escondido em repositório público é o
defeito, não a mitigação.

## O que está aqui

Arquivos que já estavam nesta pasta antes da [#638](../../../../issues) e os 12
que vieram da raiz estão igualmente indexados.

| Documento | Assunto |
|---|---|
| [`HANDOFF-canais-oficial.md`](HANDOFF-canais-oficial.md) | HANDOFF — WhatsApp API Oficial (seam de canais) |
| [`HANDOFF-casos-humanos.md`](HANDOFF-casos-humanos.md) | HANDOFF — Casos Humanos |
| [`HANDOFF-conversa-vira-lead.md`](HANDOFF-conversa-vira-lead.md) | HANDOFF — A conversa vira lead (spec 17) |
| [`HANDOFF-crm-vivo.md`](HANDOFF-crm-vivo.md) | HANDOFF — CRM Vivo |
| [`HANDOFF-followup-vivo.md`](HANDOFF-followup-vivo.md) | HANDOFF — Follow-up Vivo |
| [`HANDOFF-fv-w1-fila.md`](HANDOFF-fv-w1-fila.md) | FV-W1-FILA — o dossiê do follow-up e a intervenção humana |
| [`HANDOFF-handoff-avisa-o-lead.md`](HANDOFF-handoff-avisa-o-lead.md) | HANDOFF — o handoff avisa o lead antes de silenciar |
| [`HANDOFF-harness-evolution.md`](HANDOFF-harness-evolution.md) | HANDOFF — Épico Evolução do Harness |
| [`HANDOFF-ia-360.md`](HANDOFF-ia-360.md) | HANDOFF — IA 360 |
| [`HANDOFF-inbox-multimodal.md`](HANDOFF-inbox-multimodal.md) | HANDOFF — Épico "Inbox Multimodal + Agente de Vendas" (6 ondas) |
| [`HANDOFF-indice-de-atrito.md`](HANDOFF-indice-de-atrito.md) | HANDOFF — Índice de Atrito (spec 17) |
| [`HANDOFF-lgpd.md`](HANDOFF-lgpd.md) | HANDOFF — LGPD · achados e estado |
| [`HANDOFF-marca-propria.md`](HANDOFF-marca-propria.md) | HANDOFF — Marca Própria (whitelabel) |
| [`HANDOFF.md`](HANDOFF.md) | HANDOFF — Sistema de Follow-up Inteligente |
| [`HANDOFF-operacao-visivel.md`](HANDOFF-operacao-visivel.md) | HANDOFF — Épico "Operação Visível" (telas de transparência do agente) |
| [`HANDOFF-provedores-de-ia.md`](HANDOFF-provedores-de-ia.md) | HANDOFF — Provedores de IA: painel, logs e OpenRouter |
| [`HANDOFF-silencio-retomada-humana-nao-gruda.md`](HANDOFF-silencio-retomada-humana-nao-gruda.md) | HANDOFF — o silêncio de 3h da retomada humana não gruda no banco |
| [`HANDOFF-sistema-vivo-consertos.md`](HANDOFF-sistema-vivo-consertos.md) | HANDOFF — Consertos sob a doutrina do Sistema Vivo |
| [`HANDOFF-tres-papeis.md`](HANDOFF-tres-papeis.md) | HANDOFF — Os três papéis do agente (Conversador · Operador · Segurança) |
| [`HANDOFF-wave1-devvivo.md`](HANDOFF-wave1-devvivo.md) | Waves 1 e 2 — DevVivo · 2026-07-24 |

Também aqui: [`BRIEFING-*.md`](.) e [`CONTRATO-wave5.md`](CONTRATO-wave5.md) (briefing e contrato de onda), [`waves/`](waves/) (um arquivo por onda) e
[`2026-08-24-historico-de-captacao-e-abordagem-por-ia.md`](2026-08-24-historico-de-captacao-e-abordagem-por-ia.md).

## Documento novo

Escreva o handoff do épico **aqui**, desde o primeiro dia, e registre-o na tabela
acima. O gate cobra as duas metades: o arquivo nesta pasta e a linha no índice.
