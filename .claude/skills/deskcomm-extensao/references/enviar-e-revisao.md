# Enviar o pacote, e o que a revisão olha

## Duas coisas diferentes, e só uma precisa de nós

**Usar na sua instalação não pede permissão de ninguém.** O pacote é seu, o catálogo pode ser seu, e
quem administra a instalação admite o catálogo pela tela de Extensões. Uma agência que atende
clínicas pode ter o próprio catálogo com os próprios pacotes e nunca abrir um PR. O produto é
open source e a instalação é do cliente — essa é a leitura certa da doutrina, não um desvio dela.

**Entrar no catálogo oficial é que passa por nós**, e é o assunto desta página.

## Não existe marketplace público, e não prometemos um

A lei proíbe nominalmente anunciar, antes da prova: SDK, execução isolada de código, marketplace
público e avaliações (não-negociável 11). Então não há loja, não há contador de downloads, não há
estrela. O que existe é um catálogo revisado, e é assim que ele funciona hoje:

> Qualquer criador pode enviar; **validação automática e revisão proporcional ao perfil antecedem a
> publicação**. Teste verde não é selo, e catálogo alternativo não recebe o selo oficial.

Duas consequências práticas: **merge não publica** — a publicação é um ato humano, depois da
revisão —, e **o CI verde não é aceite**, é o piso.

## Como enviar

Por **pull request**, com revisão humana. A mecânica de PR deste repositório não se repete aqui:
branch a partir de `origin/main`, identidade dos commits, fragmento em `.changes/` quando o que você
manda muda o que quem opera uma VPS percebe — tudo isso está na skill `deskcomm-contribuir`, e ela
é o guia a carregar antes de abrir o PR.

O que é específico de um pacote:

1. **O arquivo do pacote**, exatamente como validado. Não reformate depois de calcular o digest.
2. **No corpo do PR**: o que a extensão faz, em duas frases, na voz de quem vai usar; para qual
   nicho; quais portas ela abre e por quê; e a saída do `.agents/skills/deskcomm-extensao/scripts/validar-pacote.sh` (é a sua
   medição — cole o comando e o resultado, não a conclusão).
3. **O destino declarado** (item 18 do Definition of Done): "extensão", com a razão medida pela
   pergunta-raiz. Se alguma parte do seu trabalho é núcleo, ela vai em **outro** PR.
4. **O que você não mediu.** Se não subiu a tela, diga. É o campo que separa medição de relato.

**Onde o arquivo mora no repositório ainda não está decidido** — a ADR-0003 registra isso como
pergunta em aberto (o conteúdo da loja e quem revisa cada envio). Não invente uma pasta: proponha o
pacote no PR e deixe a colocação para quem revisa. Se você inventar um caminho, a revisão vai
movê-lo, e ninguém perde nada com isso.

## O que a revisão olha

Nesta ordem, porque a primeira pergunta pode encerrar as outras:

1. **É extensão mesmo?** A pergunta-raiz, aplicada ao que o pacote faz. Conteúdo que o núcleo
   deveria ter por padrão não entra como extensão — entra como conserto do núcleo.
2. **O pacote é válido e coerente?** Schema, compatibilidade, e a cobertura permissão × capacidade.
   Isso é automático; chegar com ele vermelho é só atraso.
3. **O texto diz a verdade?** Um `summary` que sugere integração, envio de mensagem ou leitura de
   dados descreve uma extensão que não é esta. O pacote mostra texto e abre uma tela existente —
   nada mais. Esta é a leitura direta do não-negociável 11, aplicada ao seu texto.
4. **O rótulo do botão corresponde à porta?** "Ver relatório" num botão que abre Conversas é engano,
   mesmo sem má intenção.
5. **A identidade é sua?** `publisher` que se parece com uma marca conhecida, ou com a marca da
   instalação de alguém, é recusado. Autoria afirmada por quem revisou é a propriedade que um
   catálogo precisa ter — por isso ela mora no catálogo, não no seu pacote.
6. **O conteúdo justifica uma instalação?** Card genérico ("organize suas tarefas") não justifica.
   Esta é a única linha subjetiva da lista, e ela é dita na revisão com exemplos, não com nota.
7. **A versão é nova?** Mesma versão com bytes diferentes é conflito. Correção de vírgula pede
   `1.0.1`.

## Depois de publicado

- **Nenhuma origem desliga, pausa ou altera em silêncio uma extensão numa VPS.** Se o seu pacote
  tiver um defeito, quem administra a instalação desfaz a última troca ou remove — e catálogo fora
  do ar, sozinho, não desliga nada. Você não tem botão de kill-switch, e isso é deliberado.
- **Remover preserva dados.** A configuração das organizações continua guardada, e uma reinstalação
  traz os vínculos desativados: quem decide ativar é a organização, sempre.
- **Não há telemetria.** Você não vai receber número de instalações ativas vindo das VPS; qualquer
  métrica desse tipo pede decisão própria antes, com campos e retenção publicados.
