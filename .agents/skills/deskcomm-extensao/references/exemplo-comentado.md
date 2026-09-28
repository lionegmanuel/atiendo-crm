# O pacote de exemplo, comentado

O arquivo é [`pacote-de-exemplo.json`](./pacote-de-exemplo.json). Ele é válido: passa por
`parseManifest()` e por `checkCompatibility()` do host, e o comando que prova isso é o mesmo que
você vai rodar no seu:

```bash
bash .agents/skills/deskcomm-extensao/scripts/validar-pacote.sh \
  .agents/skills/deskcomm-extensao/references/pacote-de-exemplo.json
```

Copie o arquivo, troque `publisher`, `name`, os textos e os `id` dos cards, e valide de novo.
**Não copie o `sha256` de lugar nenhum** — ele é calculado dos seus bytes.

## O que ele é

Um roteiro de pós-atendimento de clínica: dois cards no hub do CRM, cada um com um botão que leva a
uma tela que já existe. Ele usa **duas** portas — Conversas e Agenda — para mostrar o vocabulário
inteiro, e as duas estão declaradas em `permissions`.

## Linha a linha, o que é decisão e o que é obrigação

```json
"host_api": { "min": 2, "max": 2 }
```
**Decisão.** É a janela que o autor garante. `min: 2` porque o pacote usa portas que só existem a
partir da versão 2 do contrato do host; um pacote que use apenas `tasks.open` pode declarar `min: 1`
e continuar honesto. `max` maior que o host atual é uma promessa sobre um contrato que você não
leu — não faça.

```json
"permissions": ["navigation.inbox", "navigation.agenda"]
```
**Obrigação.** Uma permissão para cada porta que os cards usam, sem sobra. Esta lista é o que a tela
mostra a quem vai aceitar a extensão — é a frase "esta extensão vai te levar a Conversas e à
Agenda", escrita em vocabulário de máquina.

```json
"data": { "mode": "none" },
"dependencies": []
```
**Obrigação, e é a honestidade do formato.** O pacote não guarda nada e não depende de ninguém.
Se a sua ideia precisa guardar, ela não cabe aqui — veja a última seção do `SKILL.md`.

```json
"configuration": { "density": "comfortable", "show_description": true }
```
**Decisão, com prazo de validade curto.** São os padrões com que a extensão nasce numa organização.
Depois que alguém configurou, os padrões de uma versão nova **não** alcançam essa organização — o
que o administrador escolheu vale mais que o que você mudou de ideia.

```json
"id": "quem-nao-remarcou"
```
**Decisão que vira contrato.** É o que a URL do guia carrega. Mantenha entre versões; renomear
quebra o link que alguém deixou aberto.

```json
"blocks": [ { "heading": …, "body": … } ]
```
**O conteúdo.** É onde mora o valor da extensão declarativa: o texto que uma recepcionista lê antes
de clicar. Note o que os blocos do exemplo fazem — dizem **o que fazer primeiro** e **por quê**, com
uma instrução específica ("ofereça dois horários"), não um conselho genérico. Um card que diz
"organize suas tarefas" não justifica uma instalação.

```json
"action": { "label": { "pt-BR": "Abrir conversas" }, "capability": "inbox.open" }
```
**Decisão dentro de um vocabulário fechado.** O rótulo é seu; a porta é escolhida de uma lista de
seis. Não há endereço no pacote — e o rótulo deve dizer a verdade sobre onde o clique leva.

## O que o exemplo deliberadamente não tem

- **Nenhuma URL.** Nem site do projeto, nem documentação, nem imagem. A spec recusa URL de asset no
  pacote, e um endereço clicável dentro de um pacote de terceiro, renderizado na tela de quem
  instalou, é uma porta de engano. Autoria e site do projeto são metadado de **catálogo** — o
  artefato que passa por revisão humana (ADR-0003, D3).
- **Nenhum `<b>`, nenhum markdown.** Texto é renderizado como texto.
- **Nenhuma promessa de integração.** O pacote não fala com ERP, não dispara mensagem, não lê tarefa
  nem conversa. Quem escrever um `summary` sugerindo que faz, está anunciando o que não existe.
