# Prova empírica dos dois erros de parâmetro da Meta

Medido contra a Graph API real em 2026-07-28. WABA de teste `2434045433735175`,
número `+1 555-632-0979` (`1103328999528818`), destinatário registrado.

Contexto: valida o desenho de `lib/channels/meta/template-contract.ts` e a
"regra que mata o mismatch" em `docs/doctrine/restricao-de-canal.md`.

| # | Envio | Resultado |
|---|---|---|
| 1 | `jaspers_market_image_cta_v1` (header IMAGE) **sem** `components` | **132012** — `header: Format mismatch, expected IMAGE, received UNKNOWN` |
| 2 | `jaspers_market_order_confirmation_v1` (3 params) com **2** | **132000** — `body: number of localizable_params (2) does not match the expected number of params (3)` |
| 3 | idem com os **3** corretos | **OK** — `wamid.HBgMNTUzMTk4OTY2Mzk4…` (mensagem entregue de verdade) |

## O que isto prova

1. **Header de mídia É parâmetro obrigatório**, mesmo sem `{{n}}` no template. Era
   inferência estrutural até aqui; o experimento 1 a confirmou.
2. **São dois erros distintos, com códigos distintos** — contagem (132000) e formato
   (132012). Tratá-los como um só produz mensagem de erro errada ao operador.
3. **Contar `{{n}}` previne só o 132000.** É cego ao 132012 por construção: não há
   placeholder para contar num header `format: IMAGE`. Nos 5 templates reais desta
   WABA, a contagem ingênua acha 3 parâmetros; a derivação acha 6.

## Como reproduzir

`pnpm exec tsx scripts/spike-template-contract.ts` imprime o contrato derivado dos 5
templates (fixture real em `tests/fixtures/meta/message-templates.json`).
Os testes vivem em `tests/unit/meta-template-contract.test.ts`.
