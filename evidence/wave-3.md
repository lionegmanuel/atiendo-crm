# Wave 3 — CORE 2 · o barramento e a tela que anuncia · 2026-07-24/25

**Placar final: 23 verdes · 0 vermelhos · 0 bloqueados.**

| | |
|---|---|
| Carimbo | `HEAD=c0e29b1`, sete dependências declaradas, **todas limpas** |
| Aparato | `tests/capture-wave-3-cenarios.ts` |
| Apoios | `tests/prova-canal-agent-runs.ts` · `scripts/seed-e2e-tenant-b.ts` |

> O carimbo declara **de quais arquivos a prova depende**. Se algum estiver sujo, a
> evidência nasce marcada `-ARVORE-SUJA` e acusa a si mesma. A pergunta não é "o HEAD
> andou?", é **"o delta toca a cadeia declarada?"** — sem essa cláusula, cada linha de
> handoff invalidaria todas as provas.

## Os cenários da §7

| # | Verificação | Como foi provado |
|---|---|---|
| 9 | realtime em duas abas, sem F5 | dois `BrowserContext` independentes — sessões separadas de verdade, não duas páginas do mesmo contexto |
| 9-neg | outro tenant **não vê** o dado | tenant descartável, semeado para o teste |
| 12-neg | outro tenant **não pulsa** por evento alheio | vazamento pode ser **comportamental** sem ser visual |
| 10 | timeline com ator e motivo legível | **duas** superfícies: `TimelineView` e o painel do inbox |
| 10.b | nenhum identificador cru na tela | regex de uuid no texto visível |
| 10.falha | leitura que falha **aparece como falha** | erro injetado (500) — o gate não depende do bug existir |
| 11 | a decisão de **não** enviar aparece | veto criado pelo **emissor de produção**, removido no `finally` |
| 12 | pulsa quando a mudança vem de fora | `animationstart`, não amostragem |
| 12.c | ação **local** não pulsa | o aviso anuncia o que vem de fora, não o que você fez |
| 12.d | duas chegadas seguidas = dois avisos | contagem de **inícios**, não presença de classe |
| 12.d.visivel | o aviso é **visto** | comparação de **pixels** do card: durante × depois |
| 12.rm | movimento reduzido | sem animação **e** o estado ainda legível |
| token | credencial do canal chega com `no-store` | header lido **na conexão**, com sessão real |

### As capturas

| Prova | Imagem |
|---|---|
| Realtime, aba B antes e depois da chegada | `wave-3-aba-b-antes.png` · `wave-3-aba-b-depois.png` |
| Isolamento: board do outro tenant | `wave-3-aba-c-outro-tenant.png` · `wave-3-c12-outro-tenant.png` |
| Timeline do contato com ator e motivo | `wave-3-c10-timeline-contato.png` |
| Painel do inbox — a segunda superfície | `wave-3-c10-painel-inbox.png` |
| Painel do inbox com a leitura falhando | `wave-3-c10-painel-falha-de-leitura.png` |
| A decisão de não enviar, na tela | `wave-3-c11-timeline-veto.png` |
| Pulso: depois da chegada remota | `wave-3-c12-apos-pulso.png` |
| Pulso: duas chegadas seguidas | `wave-3-c12d-duas-chegadas.png` |
| Pulso com movimento reduzido | `wave-3-c12rm-movimento-reduzido.png` |

## Os três estados

`PASS` · `FALHA` · **`BLOQUEADO`**. Reprovado acusa **quem construiu**; bloqueado acusa
**quem planejou**. Confundir os dois manda alguém caçar defeito em código correto — e
envenena a leitura do placar, porque dívida de plano vira aparência de má execução.

Um quarto estado apareceu na prática: **inconclusivo** — quando a pré-condição não valeu,
nada depois conta.

## O que este aparato recusa

- **Verde vazio.** Toda asserção do tipo *"X não aparece"* anda em par com *"e havia
  conteúdo onde X poderia aparecer"*. Sem o par, ausência de tela vira aprovação.
- **Sinal adjacente.** Antes de usar um sinal: *este valor poderia ser exatamente este se
  minha hipótese fosse falsa?* Se poderia, ele não distingue nada. Foi o que aconteceu com
  o nome da animação — idêntico numa versão que não desenha nada.
- **Espera por relógio.** Espere por **conteúdo**, nunca por tempo. E arme a espera
  **antes** do gatilho: instrumento que só observa depois de agir mede o rastro, não o
  evento.
- **Evidência sem procedência.** Resultado sem carimbo não sustenta discussão: quatro
  vezes neste dia alguém mediu um estado já superado.

## Dívida nomeada (não dissolvida em verde)

**21 decisões de não-enviar** já registradas em `before_send_traces`
(`vetoed_gate is not null`): 16 `semantic_promise`, 3 `pacing/warmup_cap`, 1
`stop/contato_bloqueado`, 1 `pacing/outside_window`.

O critério 11 prova que **veto novo** chega à tela. Não prova que esses 21 chegaram — e
não foram reescritos como atividade, porque publicar histórico retroativo numa trilha
append-only e auditada é **decisão de produto**, não conveniência de fechamento de onda.

> *"O silêncio passa a ser visível daqui para frente"* é verdade.
> *"O silêncio já registrado está visível"* é falso.
> As duas afirmações convivem — e só a segunda é dívida.

## Achado colateral: quatro canais mortos

`tests/prova-canal-agent-runs.ts` converteu suspeita em fato, por **A/B no mesmo
carregamento**: dois canais, uma sessão, um socket — o que passa pelo caminho corrigido vai
**com** identidade, o que abre conexão direta vai **sem**. Gatilho real na tabela vigiada,
zero eventos, tela imóvel, dado restaurado.

Capturas: `prova-canal-agent-runs-antes.png` · `prova-canal-agent-runs-depois.png`.

Impacto ao usuário: a tela de execuções promete acompanhamento ao vivo e dispara avisos que
**nunca aparecem**. Não é recurso ausente — é recurso que aparenta existir e mente por
omissão.
