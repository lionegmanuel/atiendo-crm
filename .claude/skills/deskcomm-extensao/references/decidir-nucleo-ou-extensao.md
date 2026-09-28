# Núcleo ou extensão — a régua, e os dois lados dela

A lei é [`docs/doctrine/extensoes.md`](../../../../docs/doctrine/extensoes.md). Aqui está ela
aplicada, com exemplos dos dois lados, porque a régua é curta e a aplicação é que engana.

## A pergunta que decide

> **Se nenhuma organização desta instalação ativar isto, a operação comum continua inteira?**

Se **sim**, pode ser extensão. Se **não** — porque identidade, autorização, isolamento, auditoria,
contratos ou a cadeia de envio dependem disto —, é núcleo.

Repare no que a pergunta **não** é: não é *"isto serve a muita gente?"*. Ser útil a vários setores
é indício de reuso, não obrigação de ficar ligado para todos. Uma rotina de comissão serve a
clínica, imobiliária e loja, e continua sendo extensão; o log de auditoria serve só a quem audita,
e é núcleo.

## Os quatro destinos

| Destino | O que sustenta a classificação |
|---|---|
| **Núcleo** | Operação comum ou garantia compartilhada: contatos, conversas, funis, identidade, autorização, trilha de ações, infraestrutura de IA, cadeia de envio. Correção de comportamento já entregue fica no componente responsável. |
| **Extensão** | Jornada adicional, aparência, integração ou especialização de nicho, com configuração, dados e manutenção próprios, cuja ausência não compromete a operação comum. |
| **Ambos** | Um ponto genérico no núcleo e uma extensão que o consome. O ponto só entra com consumidor real, contrato e prova dos dois lados — não existe inventário de ganchos hipotéticos. |
| **Infraestrutura / documentação** | Build, CI, kit de instalação, ferramenta interna, documentação. Um `update.sh` que falhava é infraestrutura. |

## Extensão — exemplos

- **Comanda de barbearia**, **comissão de vendedor**, **cartão de fidelidade**: jornada de nicho
  com dados próprios; desligada, ninguém perde conversa, funil nem envio.
- **Tema visual**, **conjunto de orientações de um método de vendas**: aparência e conteúdo.
- **Integração com um ERP específico de um segmento**: quem não usa aquele ERP não perde nada.
- **Um roteiro de pós-atendimento de clínica** (o pacote de exemplo desta skill): texto que orienta
  e leva às telas que já existem.

## Núcleo — exemplos, e por que doem

- **Caixa: contas, formas de pagamento, plano de contas, lançamento avulso.** É núcleo **por
  decisão do dono do produto**, não por dedução da régua — está escrito na doutrina. O que vira
  extensão é o que fica **em cima** dele. "Financeiro" não é um destino só.
- **Papéis, permissão, MFA, isolamento entre organizações**: são a garantia compartilhada. Uma
  instalação sem eles não é uma instalação mais simples, é uma instalação quebrada.
- **Auditoria e recibos**: se pudessem ser desligados, a prova de quem fez o quê seria opcional.
- **Cadeia de envio do WhatsApp, anti-banimento, detecção de STOP**: a operação comum inteira
  depende disso; e uma regra de opt-out que valesse só para quem instalou algo é um passivo legal.
- **Corrigir um comportamento que já foi distribuído.** Se o funil erra uma conta, o conserto é no
  funil. Classificar como "seria extensão" não autoriza tirar do núcleo o que já está na VPS de
  alguém: isso exige equivalência demonstrada e migração explícita.

## "Ambos" — o caso mais comum de PR grande

Você quer uma jornada de nicho, e ela precisa de um ponto que o núcleo não oferece. O destino é
**ambos**: um ponto genérico no núcleo, com contrato, e a extensão que o consome. A condição é
dura de propósito — o ponto entra **com o consumidor real junto**, não antes. Inventário de
ganchos que talvez alguém use é dívida com cara de arquitetura.

Na prática, isso quase sempre quer dizer: abra uma issue descrevendo a jornada inteira e espere o
desenho do ponto, em vez de mandar o gancho sozinho.

## O que fazer quando o destino é "extensão" e a ferramenta ainda não existe

Este é o caso mais frequente hoje, e a resposta honesta importa mais que a régua.

O pacote declarativo que existe **não tem tabela, tela, menu nem código**. Comanda, comissão e
fidelidade são extensões pela régua e **não são construíveis como pacote hoje** — precisam guardar
dado. O caminho delas é o módulo nativo da
[ADR-0002](../../../../docs/adr/0002-tabelas-de-modulo-num-banco-so.md), aceita em 17/09/2026 e
**ainda não construída**. Não há data, e este guia não inventa uma.

A doutrina prevê exatamente esta situação: *"enquanto a plataforma está em construção, 'extensão' é
destino, não exigência de usar uma ferramenta que ainda não existe"*. Então:

1. Não jogue fora o trabalho. Registre a jornada numa issue, com o que ela precisa guardar.
2. Se parte do que você fez é genérica e útil ao núcleo hoje (um conserto, um ponto que a operação
   comum já usa), separe essa parte — ela entra pelo caminho normal de PR.
3. Se o que sobra é conteúdo — orientação, roteiro, sequência de passos —, isso **é** empacotável
   hoje. Vire um pacote declarativo e envie.
4. Todo PR que muda comportamento declara o destino e a razão (item 18 do Definition of Done).
   Declarar "extensão, e a jornada com dados espera a ADR-0002" é uma resposta completa.
