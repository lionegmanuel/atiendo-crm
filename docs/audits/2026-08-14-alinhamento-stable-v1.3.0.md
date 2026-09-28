# Alinhamento do canal `stable` da v1.3.0 — evidência

**Data:** 2026-08-14 · **Operação:** re-aponte da tag `stable` para o manifest da `1.3.0`,
nos três pacotes. **Sem rebuild** — o mesmo índice OCI, sob outra tag.

## Por que foi preciso

O workflow reagia a `push: tags` **e** a `release: published`. `gh release create` faz as
duas coisas, então o mesmo commit foi construído duas vezes (19:53 e 19:58 de 2026-08-13).
O segundo run moveu `1.3.0` e `1.3` para o build novo e **não** moveu `stable`, que ficou no
build anterior. `revision` e `version` eram idênticos nos seis manifests; só o `created`
diferia. Gatilho removido no PR #251, com guarda em
`tests/unit/packaging-artefato-do-cliente.test.ts`.

## Como foi feito

O daemon do Docker estava parado, então em vez de `docker buildx imagetools create` a
operação foi feita pela API do registry — que é o que o `imagetools` faz por baixo: `GET`
do índice de `1.3.0` e `PUT` do **mesmo corpo** sob a tag `stable`, com o mesmo
`Content-Type: application/vnd.oci.image.index.v1+json`. Blob nenhum foi copiado: o índice
referencia os manifests filhos por digest, e eles já estavam no mesmo repositório.
Os três `PUT` responderam **HTTP 201**.

## Antes e depois

A medição do "depois" foi feita com **token anônimo de pull**, não com a credencial que
escreveu — uma escrita que só se confirma pela própria sessão que a fez não está confirmada.

| pacote | tag | antes | depois | |
|---|---|---|---|---|
| `deskcommcrm` | `1.3.0` | `fc10b029e326` | `fc10b029e326` | alinhado ✓ |
| `deskcommcrm` | `1.3` | `fc10b029e326` | `fc10b029e326` | alinhado ✓ |
| `deskcommcrm` | `stable` | `c4bc70b606c8` | `fc10b029e326` | alinhado ✓ *(alterado)* |
| `deskcommcrm` | `latest` | `2f90346bf86d` | `2f90346bf86d` | **controle** — não podia mudar ✓ |
| `deskcommcrm` | `main` | `2f90346bf86d` | `2f90346bf86d` | **controle** — não podia mudar ✓ |
| `deskcomm-worker` | `1.3.0` | `81e5af567cc8` | `81e5af567cc8` | alinhado ✓ |
| `deskcomm-worker` | `1.3` | `81e5af567cc8` | `81e5af567cc8` | alinhado ✓ |
| `deskcomm-worker` | `stable` | `3fe292cad2bd` | `81e5af567cc8` | alinhado ✓ *(alterado)* |
| `deskcomm-worker` | `latest` | `6f7c03a5b96c` | `6f7c03a5b96c` | **controle** — não podia mudar ✓ |
| `deskcomm-worker` | `main` | `6f7c03a5b96c` | `6f7c03a5b96c` | **controle** — não podia mudar ✓ |
| `deskcomm-scheduler` | `1.3.0` | `4396263ba807` | `4396263ba807` | alinhado ✓ |
| `deskcomm-scheduler` | `1.3` | `4396263ba807` | `4396263ba807` | alinhado ✓ |
| `deskcomm-scheduler` | `stable` | `a0d5c3ad2296` | `4396263ba807` | alinhado ✓ *(alterado)* |
| `deskcomm-scheduler` | `latest` | `c6be866e2b26` | `c6be866e2b26` | **controle** — não podia mudar ✓ |
| `deskcomm-scheduler` | `main` | `c6be866e2b26` | `c6be866e2b26` | **controle** — não podia mudar ✓ |

## Confira você mesmo

```bash
for p in deskcommcrm deskcomm-worker deskcomm-scheduler; do
  for t in 1.3.0 1.3 stable; do
    echo -n "$p:$t "
    docker buildx imagetools inspect ghcr.io/melgarafael/$p:$t | awk '/^Digest:/{print $2}'
  done; done
```

Os três de cada pacote têm que bater. Se não baterem, alguma coisa republicou depois do
push da tag — e isso é o invariante 3 da doutrina quebrado dentro de casa.
