# ENTREGA — Frente 2 · Telas da Agenda (@VPS)

prova-em-tela: tests/e2e/agenda-kit-visual.spec.ts

> Esta frente TEM pixel, então a linha acima não é uma promessa: a spec existe,
> roda no CI (`SPECS_PARTE_2` do `e2e.yml`) e fechou **17/17** no momento deste
> registro. Declaro assim mesmo porque o gate do maestro
> (`tests/unit/entrega-sem-tela-declara-quem-prova.test.ts`) confere que o
> caminho existe — e um registro que passa por já ser verdade custa nada e
> mantém o formato uniforme para quem varrer depois.

## O que está provado, e por qual asserção

| # | o que a asserção garante |
|---|---|
| 1 | a grade troca de visão pelo clique, e cada visão desenha o que promete |
| 2 | a régua do agora cai no minuto certo — medida em pixels, não a olho |
| 3 | a coluna de horários não existe no 1º tempo e entra ao escolher o dia (0 → 278px, painel 702 → 979px) |
| 4 | quem pediu para não receber mensagem: marca igual, e a tela avisa ANTES |
| 5 | e quem aceita mensagem NÃO vê o aviso (o par que impede aviso-sempre) |
| 6 | dia sem horário nasce apagado e não aceita clique |
| 7 | filtrar por pessoa isola a agenda dela — e só a dela |
| 8 | dois agendamentos no mesmo horário dividem a largura, medido por geometria |
| 9 | ocupação do Google é ocupação: não abre, e não usa cor de pessoa |
| 10 | as 8 trilhas passam em contraste e são distinguíveis nos DOIS temas |
| 11 | controle que promete ação ou FAZ, ou está desabilitado com o motivo |
| 12 | o número que a tela afirma é o número que a tela mede |
| 13 | a data em pt-br não maiúscula a preposição (varredura do texto renderizado) |
| 14 | o histórico separa as 4 abas, e cancelado não aparece em próximos |
| 15 | o histórico não oferece ação que não pode cumprir |
| 16 | o passado registra o desfecho — senão `realizado` e `faltou` ficam sem escritor |
| 17 | evidência visual: claro, escuro e celular |

Evidência visual: `kit-visual-claro.png`, `kit-visual-escuro.png`,
`kit-visual-celular.png`, `painel-coluna-aberta.png` (nesta pasta).

## O que esta frente NÃO prova, e depende da frente 1

Marcar, remarcar, cancelar, registrar desfecho e filtrar **com dado real**, mais o
histórico alimentado pelo banco. Até lá `/app/agenda` cai no estado vazio
(decisão 18) e todo controle que dependeria da API nasce desabilitado **com o
motivo à vista** — nunca habilitado e inerte.

Quando a frente 1 subir, o que muda é **quem passa a prop**. A tela, o histórico e
o kit não mudam: foram desenhados contra os tipos, não contra a fixture.
