# Prova em tela — épico "casos vivos"

Bancada: Supabase isolado (portas próprias, sem encostar em outra sessão), `supabase/baseline.sql`
aplicado do zero — 139 tabelas, modo install com `ON_ERROR_STOP=1` —, `scripts/seed-e2e-credentials.ts`
e `scripts/seed-e2e-escalacao.ts`, build de produção (`next build` + `next start`) na porta 3107,
**sem chave de IA** (o dublê `INTERNAL_AGENT_RUN_STUB`, que é como o CI roda). É o mais perto de
uma VPS recém-instalada que esta máquina permite.

> **O que é afirmação e o que é imagem.** Daqui para baixo, toda medida de layout foi feita
> por `getBoundingClientRect` / `getComputedStyle` DENTRO do navegador, dirigida por
> Playwright — as imagens ilustram, quem afirma é a medição. Captura `fullPage` mente sobre
> posição de elemento fixo (a barra lateral aparece empilhada no meio do conteúdo); é
> artefato de captura rolada, não defeito de layout.

---

## As três specs da prova em tela (onda 12)

| funcionalidade | spec | onde roda |
|---|---|---|
| conversar com a IA do caso | [`tests/e2e/conversa-do-caso.spec.ts`](../../tests/e2e/conversa-do-caso.spec.ts) | `SPECS_PARTE_2` |
| aviso no WhatsApp — a tela de uma instalação nova | [`tests/e2e/aviso-de-caso-no-whatsapp.spec.ts`](../../tests/e2e/aviso-de-caso-no-whatsapp.spec.ts) | `SPECS_PARTE_2` |
| aviso no WhatsApp — o envio de verdade | [`tests/e2e/aviso-de-caso-chega-no-whatsapp.spec.ts`](../../tests/e2e/aviso-de-caso-chega-no-whatsapp.spec.ts) | `FORA_DO_CI`, com o motivo escrito no workflow |
| a passagem para humano chega com contexto | [`tests/e2e/passagem-com-contexto.spec.ts`](../../tests/e2e/passagem-com-contexto.spec.ts) | `SPECS_PARTE_3` |

---

## 1. Conversar com a IA que abriu o caso

| imagem | o que ela mostra |
|---|---|
| [`evidence/casos-vivos/chat/10-caso-aberto.png`](evidence/casos-vivos/chat/10-caso-aberto.png) | o caso aberto por um `manager`: o que o cliente precisa, por que a IA travou, as decisões e o painel "Conversar sobre o caso" — com o **aviso de persona** ("A IA que abriu este caso não está mais no ar… quem responde é o assistente padrão da organização") |
| [`evidence/casos-vivos/chat/20-pergunta-digitada.png`](evidence/casos-vivos/chat/20-pergunta-digitada.png) | a pergunta da equipe no campo, antes de enviar |
| [`evidence/casos-vivos/chat/30-resposta-da-ia.png`](evidence/casos-vivos/chat/30-resposta-da-ia.png) | **a prova**: pergunta e resposta com autor ("Pergunta da equipe" / o nome da IA) e hora, sem tocar a conversa do cliente |
| [`evidence/casos-vivos/chat/40-telefone.png`](evidence/casos-vivos/chat/40-telefone.png) | a mesma tela em 390px de largura — medida: **zero** rolagem horizontal |
| [`evidence/casos-vivos/chat/50-colega-ve-a-pergunta.png`](evidence/casos-vivos/chat/50-colega-ve-a-pergunta.png) | **compartilhamento**: outra pessoa da equipe (`agent`) abre o mesmo caso e vê a pergunta de quem chegou antes |
| [`evidence/casos-vivos/chat/60-agente-sem-visibilidade.png`](evidence/casos-vivos/chat/60-agente-sem-visibilidade.png) | com a organização em `visibility_mode='own'`, o `agent` que não é dono da conversa vê **"Nenhum caso aberto"** |
| [`evidence/casos-vivos/chat/61-link-direto-nao-entrega.png`](evidence/casos-vivos/chat/61-link-direto-nao-entrega.png) | e o link direto para o caso **também não entrega** — a fila esconder e o detalhe abrir seria a porta dos fundos da RLS |
| [`evidence/casos-vivos/chat/70-contato-anonimizado.png`](evidence/casos-vivos/chat/70-contato-anonimizado.png) | contato anonimizado: o campo some e entra a frase que **explica o motivo** |

Medido por ferramenta nesta jornada (janela 1440×1000): botão "Perguntar" visível
(`offsetParent` não nulo), fonte `Atkinson Hyperlegible` (a do produto, não a do sistema),
fundo com cor resolvida, painel dentro da janela, rolagem horizontal **0** em 1440px e em
390px. O painel não contém `case_chat`, `purpose`, `llm_call`, `undefined`, `null` nem
`error_code`.

**O que estas imagens NÃO provam:** o estado "sem chave de IA" — o dublê
`INTERNAL_AGENT_RUN_STUB` injeta uma chave, então `ia_configurada` é sempre verdadeiro sob
ele. Aquele ramo é guardado por `tests/unit/`.

### As três imagens antigas, que ficam como registro e não como prova

[`evidence/casos-vivos/chat/01-entrou.png`](evidence/casos-vivos/chat/01-entrou.png) mostra a tela de login em branco (o nome promete o contrário);
[`evidence/casos-vivos/chat/03-detalhe-do-caso.png`](evidence/casos-vivos/chat/03-detalhe-do-caso.png) mostra a tela de Contatos carregando, não o detalhe de caso nenhum;
[`evidence/casos-vivos/chat/02-lista-de-casos.png`](evidence/casos-vivos/chat/02-lista-de-casos.png) é a única das três que mostra o que o nome diz. O julgamento completo
está em `docs/testing/user-journey-map.md`. As demais capturas da primeira tentativa —
[`evidence/casos-vivos/chat/10-lista.png`](evidence/casos-vivos/chat/10-lista.png), [`evidence/casos-vivos/chat/20-login-resultado.png`](evidence/casos-vivos/chat/20-login-resultado.png), [`evidence/casos-vivos/chat/30-casos.png`](evidence/casos-vivos/chat/30-casos.png),
[`evidence/casos-vivos/chat/31-caso-aberto.png`](evidence/casos-vivos/chat/31-caso-aberto.png), [`evidence/casos-vivos/chat/32-pergunta-digitada.png`](evidence/casos-vivos/chat/32-pergunta-digitada.png), [`evidence/casos-vivos/chat/33-resposta.png`](evidence/casos-vivos/chat/33-resposta.png) e
[`evidence/casos-vivos/chat/40-chat-com-resposta.png`](evidence/casos-vivos/chat/40-chat-com-resposta.png) — são da exploração manual que antecedeu a spec.
A captura `evidence/casos-vivos/chat/20-login-resultado.png` guarda um achado de AMBIENTE: "Email ou senha incorretos" com a
senha certa, porque o serviço de autenticação da bancada devolveu 500 por tempo esgotado no
banco e o produto traduz isso para credencial inválida. É por isso que o helper de login das
specs tenta quatro vezes.

---

## 2. O aviso no WhatsApp

### 2a. A tela que uma instalação NOVA encontra (roda no CI)

| imagem | o que ela mostra |
|---|---|
| [`evidence/casos-vivos/aviso/10-manager-nao-entra.png`](evidence/casos-vivos/aviso/10-manager-nao-entra.png) | um `manager` abre o endereço e cai em **403** — a tela escolhe um número conectado e manda dado de cliente para um celular |
| [`evidence/casos-vivos/aviso/20-tela-do-aviso.png`](evidence/casos-vivos/aviso/20-tela-do-aviso.png) | a tela aberta pelo `admin` (com verificação em duas etapas), com o alerta **"Este sistema ainda não tem um endereço na internet"** ANTES do formulário |
| [`evidence/casos-vivos/aviso/30-configurado-mas-recusado.png`](evidence/casos-vivos/aviso/30-configurado-mas-recusado.png) | número e conexão salvos, e o interruptor continua **travado** — o produto se recusa a ligar um aviso cujo link não abriria nada |
| [`evidence/casos-vivos/aviso/40-teste-recusado-com-motivo.png`](evidence/casos-vivos/aviso/40-teste-recusado-com-motivo.png) | "enviar aviso de teste" **recusa dizendo o que falta e quem resolve**, não um "não deu certo" |
| [`evidence/casos-vivos/aviso/50-telefone.png`](evidence/casos-vivos/aviso/50-telefone.png) | a mesma tela em 390px — rolagem horizontal **0** |
| [`evidence/casos-vivos/aviso/60-entrega-recusada-na-tela.png`](evidence/casos-vivos/aviso/60-entrega-recusada-na-tela.png) | **a recusa honesta ponta a ponta**: com um caso aberto de verdade e o dreno rodado, a entrega vira linha `falhou / sem_endereco_publico` e a lista da tela explica por quê |

Mais duas da exploração que antecedeu a spec: [`evidence/casos-vivos/aviso/40-tela-como-manager.png`](evidence/casos-vivos/aviso/40-tela-como-manager.png) e
[`evidence/casos-vivos/aviso/50-tela-do-aviso.png`](evidence/casos-vivos/aviso/50-tela-do-aviso.png).

Medido por ferramenta: o bloco de alertas vem ANTES do formulário no fio do DOM
(`compareDocumentPosition`), o botão "Salvar" está alcançável, com a fonte do produto e
dentro da janela, e o texto visível não contém `config_aviso_de_caso`,
`channel_session_id`, `sem_endereco_publico`, `waha` nem `http://`.

### 2b. O envio de verdade, com um receptor HTTP no lugar do WhatsApp

Esta é a spec de `FORA_DO_CI`: ela precisa de um `NEXT_PUBLIC_APP_URL` público, e o
`.env.e2e` do CI aponta para `localhost` por construção. Rodada nesta bancada com
`NEXT_PUBLIC_APP_URL=https://crm.bancada-casos-vivos.example.com` e um servidor HTTP de
verdade na porta que o `.env.e2e` declara como transporte.

| imagem | o que ela mostra |
|---|---|
| [`evidence/casos-vivos/aviso/70-configurado-e-ligado.png`](evidence/casos-vivos/aviso/70-configurado-e-ligado.png) | com endereço público o alerta bloqueante some e o interruptor **destrava** |
| [`evidence/casos-vivos/aviso/71-teste-enviado.png`](evidence/casos-vivos/aviso/71-teste-enviado.png) | "Aviso de teste enviado" — e o receptor registrou **um** `POST /api/sendText` |
| [`evidence/casos-vivos/aviso/72-entrega-enviada.png`](evidence/casos-vivos/aviso/72-entrega-enviada.png) | a lista "Últimos avisos enviados" com a situação **enviado** |
| [`evidence/casos-vivos/aviso/73-linha-do-tempo-do-caso.png`](evidence/casos-vivos/aviso/73-linha-do-tempo-do-caso.png) | na linha do tempo do caso, **"Avisamos o suporte no WhatsApp"** — quem abre o caso sabe que a equipe já foi avisada |

**O texto que saiu de verdade** está em
[`evidence/casos-vivos/aviso/aviso-que-saiu.txt`](evidence/casos-vivos/aviso/aviso-que-saiu.txt), gravado pela própria spec a partir do corpo
que chegou no receptor:

```
🔔 DeskcommCRM: novo caso esperando você

Tipo: Outro
Assunto: Desconto fora da alçada lote mejiut
Cliente: Escalação
O que o cliente precisa: Cliente de 200 unidades pedindo 20% de desconto.
Por que a IA travou: a política do agente vai até 10%

Abrir: https://crm.bancada-casos-vivos.example.com/app/ai/cases?caso=37cdf572-…

Responder aqui não chega ao cliente — abra o link para responder.
```

Asserções sobre esse corpo: **tem** o assunto, o **primeiro** nome do cliente e o link do
caso; **não tem** o sobrenome, **não tem** o telefone do cliente (`+5531977776666` nem
`977776666`) e **não tem** trecho de conversa; termina com a linha que impede a equipe de
responder para o vazio. A chave do transporte vai no **cabeçalho**, nunca na URL. Drenar de
novo duas vezes mantém **um** envio (idempotência).

---

## 3. A passagem para humano chega com contexto

| imagem | o que ela mostra |
|---|---|
| [`evidence/casos-vivos/passagem/10-cartao-na-conversa.png`](evidence/casos-vivos/passagem/10-cartao-na-conversa.png) | o cartão **"Por que a IA passou para você"** dentro do fio: motivo em português, "O cliente quer", "A IA já tentou" (numerada, com o desfecho) e "Últimas palavras do cliente" entre aspas |
| [`evidence/casos-vivos/passagem/20-cartao-no-telefone.png`](evidence/casos-vivos/passagem/20-cartao-no-telefone.png) | o mesmo cartão em 390px, inteiro e sem rolagem lateral |
| [`evidence/casos-vivos/passagem/30-central-aponta-para-a-conversa.png`](evidence/casos-vivos/passagem/30-central-aponta-para-a-conversa.png) | a Central com "O assistente passou um atendimento para um humano" e o gesto **"Abrir conversa"** apontando para aquela conversa |
| [`evidence/casos-vivos/passagem/40-cartao-reconhecido.png`](evidence/casos-vivos/passagem/40-cartao-reconhecido.png) | depois de "Assumir e responder": o cartão deixa de convidar e passa a dizer **quem assumiu** |
| [`evidence/casos-vivos/passagem/50-central-sem-o-aviso.png`](evidence/casos-vivos/passagem/50-central-sem-o-aviso.png) | e o aviso saiu dos abertos da Central **sozinho** — prova do gatilho, ninguém apertou "resolver" |

Medido por ferramenta: o cartão tem altura > 40px (um cartão de 0px está montado e
invisível), cabe na janela, a conversa não rola para o lado em 1440px nem em 390px, e o
convite "Assumir e responder" está **dentro da janela** — ver o achado abaixo. O cartão não
contém `requested_human`, `suspected_optout`, `ferramenta_do_modelo` nem `motivo_codigo`.

**O achado que só a medição pegava.** A primeira rodada mediu o botão "Assumir e responder"
em **y=1008 numa janela de 720px** — montado, clicável por programa e **abaixo da dobra do
fio**. Causa: `ChatThread` decidia "a abertura já terminou" pelo contador de páginas da
consulta de MENSAGENS, e o cartão chega de uma consulta própria, depois da primeira pintura
— numa conversa sem mensagens (o normal logo após uma passagem) a guarda "o usuário está
lendo o histórico" passava a valer sobre alguém que não tinha rolado nada, e o fio nunca
descia até o cartão. Consertado na causa em `components/inbox/ChatThread.tsx`, e a medição
do botão contra a janela é a catraca que impede a volta.

**O que esta spec NÃO prova:** o caminho em que o próprio modelo decide passar (a ferramenta
`request_human_handoff`) e a passagem por `suspected_optout` — a única que não pode oferecer
"Assumir e responder". As duas são guardadas por `tests/unit/cartao-da-passagem.test.ts`
sobre a função pura que o JSX consome.
