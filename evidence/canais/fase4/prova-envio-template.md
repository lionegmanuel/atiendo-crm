# A saída funciona — template disparado pelo caminho completo

Fase 4, Task 4. **Um envio**, no número de teste, para o WhatsApp real do dono do repo.

Saída literal em [envio-real-template.txt](evidence/canais/fase4/envio-real-template.txt):

```
espelho: deskcomm_prova_webhook_0088 (pt_BR) status=APPROVED
hash vigente: ef3bd0e67fc4122b…
resultado: {"sent":true,"externalId":"wamid.HBgMNTUzMTk4OTY2Mzk4FQIAERgSNDIyRkVDRjRERjhFNTMzRTU3AA=="}
```

## O que a linha `sent: true` custou de checagens

Nenhuma delas é "tentar e ver" — a Meta cobra por mensagem entregue e só responde
132000/132012 **depois** de aceitar a chamada:

1. **`bindingState`** — o hash do bind bate com o do espelho? o template existe? está
   aprovado? O hash veio do banco, não digitado: digitá-lo simularia o bind em vez de
   exercitá-lo.
2. **`missingSlots`** — todos os parâmetros têm valor? (espaço em branco conta como
   ausente)
3. **`buildComponents`** — a MESMA função que alimenta o formulário da tela monta o
   payload. Uma derivação, dois consumidores.

Só então a chamada sai.

## Por que isto é o anti-morte do gate

O `messagingWindowGate` (Task 3) veta texto livre fora da janela. Sozinho, ele
transformaria follow-up em silêncio: o modelo é vetado, não tem o que fazer, e o lead
fica sem resposta — o oposto do invariante 4 do sistema vivo.

Esta é a porta que a parede precisava. A `reason` do veto **nomeia** a ferramenta
(`send_template`), e a Task 5 a coloca na mão do modelo.

## Sabotagens verificadas (8 casos)

| Sabotagem | Vermelho |
|---|---|
| não checar o bind | 3 casos |
| não checar valores faltando | 2 casos |
| mandar `components: []` em template sem parâmetro | 1 caso |

Cada uma restaurada e a suíte de volta a 8 verdes.
