# Tela de conexão do canal oficial — o que foi provado e o que não

Jornada em `tests/journeys/canal-oficial.spec.ts`, contra build de produção e a
Graph API real.

## Provado (2 de 3)

| | |
|---|---|
| 1 | O admin chega à tela **clicando** pelo hub de configurações. |
| 2 | **Credencial errada é recusada com 422** e a conexão existente fica intacta — o número real continua na tela e o id inventado não entra em lugar nenhum. |

O caso 2 é o que separa "validar" de "aceitar e torcer": ele fala com a Graph API de
verdade, sem mock, porque mockar a validação testaria o mock.

## NÃO provado (1 de 3), e o motivo é um achado

O caso 3 (conectar com credencial real) devolve **422**, e o código está certo:

```
token na Meta        → válido ("Test Number")
app.nuvemshop_oauth_key → GUC AUSENTE neste banco
```

A rota recusa gravar quando a cifra não está disponível — porque gravar um token de
acesso em claro seria pior que recusar. O 422 traz a mensagem exata
(`cifra indisponível nesta instalação … o token não foi gravado`).

Não consegui provisionar a chave localmente: o Supabase local recusa
`ALTER DATABASE ... SET` como `postgres`, e `supabase_admin` pede senha que não tenho.

## ⚠️ O achado, que é maior que o teste

**`hostgator-setup-kit/install.sh` não provisiona `app.nuvemshop_oauth_key`** — nem o
`update.sh`. Medido por `grep`.

Consequência em **toda instalação self-host de hoje**, não só no canal oficial:

- `fn_encrypt_oauth` levanta erro;
- segredo de webhook e token OAuth do Nuvemshop não são cifrados at-rest;
- a credencial da Meta não pode ser gravada.

A doutrina do repo já diz como injetar (`docs/specs/06-spec-nuvemshop-lgpd.md:491`:
`ALTER DATABASE ... SET`, nunca em SQL versionado). O que falta é o kit fazer isso na
instalação — hoje o passo existe na spec e não no script.

Isto é anterior a este épico e afeta features já na `main`. Registrado aqui porque foi
o guard da Fase 5 que o tornou visível.
