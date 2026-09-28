# Testar o pacote antes de enviar — o caminho honesto

Três degraus, do barato ao caro. Suba só até onde a sua mudança pede, e **declare até onde subiu**
quando enviar. "Validei o pacote, não subi o ambiente" é um relato melhor que um relato completo
que ninguém mediu.

## Degrau 1 — o schema real (30 segundos, sem Docker)

```bash
bash .agents/skills/deskcomm-extensao/scripts/validar-pacote.sh caminho/do/pacote.json
```

Precisa de um clone do DeskcommCRM com as dependências instaladas. O script chama `parseManifest()`
e `checkCompatibility()` **do host** — não uma cópia das regras —, e imprime, quando passa, a
entrada de catálogo com `sha256` e `byte_length` já calculados. Sai 1 quando o pacote é recusado.

Ele não julga o conteúdo: um pacote vazio de sentido passa aqui. Passar é o piso, não o aceite.

## Degrau 2 — o catálogo de ensaio (local, sem Docker)

Existe um catálogo de laboratório em `experiments/extensoes/catalog/` — processo próprio, SQLite
próprio, servindo artefatos só em `127.0.0.1`. O README dele tem a sequência
(`init` → `make-example` → `publish` → `export` → `serve`) e o CRM admite o arquivo exportado pela
tela de Extensões.

**Antes de usar, confira contra o que ele valida.** A CLI é um processo separado e carrega a
**própria** cópia das regras, escrita para o contrato v1:

```bash
grep -n "navigation.tasks\|tasks.open\|host_api" experiments/extensoes/catalog/catalog.py
```

Se a saída ainda exigir `permissions == ["navigation.tasks"]` e `capability == "tasks.open"`, a CLI
**recusa** um pacote que use as portas novas, e o `make-example` dela gera um pacote com
`host_api {"min":1,"max":1}` — que o host atual considera incompatível. Nesse estado, o degrau 2 só
serve para pacotes de uma porta só; para os demais, o degrau 1 é a validação que vale, e o degrau 3
é a prova. Isto é limitação do laboratório, não do seu pacote — e é uma contribuição útil por si só,
se você quiser consertá-la.

## Degrau 3 — a tela, num ambiente estilo VPS

É o que a doutrina de QA Visual do repositório exige de qualquer mudança visível: banco fresco
aplicado do `supabase/baseline.sql`, aplicação em modo produção, Playwright dirigindo o front. As
jornadas de extensão já têm specs (`tests/e2e/extensoes-declarativas.spec.ts`,
`tests/e2e/extensoes-recuperacao.spec.ts`, `tests/e2e/extensoes-versao.spec.ts`), e a receita de
ambiente está na skill `deskcomm-contribuir`.

Para um **pacote**, este degrau prova o que nenhum schema prova: o texto cabe na tela, o rótulo do
botão diz a verdade sobre onde o clique leva, e o card faz sentido para quem nunca leu o seu README.
Se você não tem como subir o ambiente, diga isso ao enviar — a prova de tela fica com quem revisa,
e é o combinado público.

## O que rodar se você mexeu no **código** das extensões (não só no pacote)

```bash
pnpm test:unit > /tmp/vt.log 2>&1; echo exit=$?
grep -aE "Test Files|Tests " /tmp/vt.log | tail -2
pnpm test:db; echo exit=$?     # toca schema, RLS ou as RPCs fn_extensions_*
```

`pnpm test:unit` **sem caminho** — o script alcança os testes colocados em `lib/` e `components/`,
que é onde moram os do serviço e os da tela de extensões. Os invariantes de banco
(`tests/invariants/extensoes-declarativas.test.ts`) não estão no `test:unit`: rodam por `test:db`,
com Postgres real, e são eles que exercitam isolamento, idempotência e precondição.
