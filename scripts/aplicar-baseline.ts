/**
 * Aplica `supabase/baseline.sql` numa base Postgres (Supabase ou outra) pela
 * connection string — sem o SQL Editor do painel e sem `psql` instalado.
 *
 *   pnpm db:aplicar                       # lê SUPABASE_DB_URL do .env.local
 *   pnpm db:aplicar -- --url="postgresql://..."
 *   pnpm db:aplicar -- --modo=install     # força o modo (padrão: detecta)
 *   pnpm db:aplicar -- --solo-verificar   # só confere se a base está completa (não escreve)
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * O baseline tem mais de 40 mil linhas e 2 MB. Colado no SQL Editor do
 * Supabase, uma base ficou sem os últimos blocos do apêndice (coluna
 * `crm_stages.avisar_na_central`, bucket `org-sounds`, trigger
 * `trg_aviso_da_central_criado`) — e o erro só apareceu depois, em segundo
 * plano, a cada cartão movido. Aqui a aplicação é medida: o script sabe se
 * chegou ao fim do arquivo e confere no banco que os objetos do fim existem.
 *
 * ─── Os dois modos, iguais aos do kit ───────────────────────────────────────
 *
 * - `install` (base sem `public.organizations`): como o `install.sh`
 *   (`psql -v ON_ERROR_STOP=1`) — para no primeiro erro e diz a linha.
 * - `update` (base que já tem o CRM): como o `update.sh` (`psql` sem
 *   ON_ERROR_STOP) — o baseline é idempotente, então `already exists` do corpo
 *   do dump é esperado; erro de outra natureza é listado no fim.
 *
 * As sentenças vão em lotes (uma ida ao banco por lote, não por sentença: são
 * milhares, e pelo pooler cada ida custa dezenas de milissegundos). No modo
 * `update`, cada sentença do lote roda num bloco com EXCEPTION, para o erro de
 * uma não desfazer as outras.
 *
 * A connection string nunca é impressa. Use a do Session pooler (porta 5432):
 * o Transaction pooler (6543) não mantém `SET` entre sentenças.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

import { dividirSql, type Sentenca } from "./lib/dividir-sql";

const RAIZ = resolve(__dirname, "..");
const BASELINE = join(RAIZ, "supabase", "baseline.sql");
const SENTENCAS_POR_LOTE = 100;
const BYTES_POR_LOTE = 256 * 1024;
const TENTATIVAS_POR_LOTE = 3;

/** Os mesmos de `BASELINE_ERROS_BENIGNOS` em `hostgator-setup-kit/_common.sh`. */
const ERROS_BENIGNOS =
  /already exists|multiple primary keys|multiple default values|is already a member|already a partition/i;
/** Disputa com o app no ar ou conexão instável: repetir o lote cura. */
const ERROS_DE_DISPUTA =
  /deadlock detected|could not serialize access|lock timeout|could not obtain lock|terminating connection|connection terminated|ECONNRESET|server closed the connection/i;

type Modo = "install" | "update";

interface Erro {
  linha: number;
  mensagem: string;
}

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

function urlDaBase(): string {
  const url = argumento("url") ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
  if (!url.trim()) {
    console.error(
      [
        "",
        "✗ Falta la cadena de conexión de la base.",
        "",
        "  Agregala en .env.local (Supabase › Connect › Session pooler, puerto 5432):",
        '    SUPABASE_DB_URL="postgresql://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres"',
        "",
        "  o pasala al comando:",
        '    pnpm db:aplicar -- --url="postgresql://..."',
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  return url.trim();
}

/** Host e porta para a tela — nunca usuário nem senha. */
function ondeConecta(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(cadena de conexión no es una URL válida)";
  }
}

function lotes(sentencas: Sentenca[]): Sentenca[][] {
  const saida: Sentenca[][] = [];
  let atual: Sentenca[] = [];
  let bytes = 0;
  for (const s of sentencas) {
    if (atual.length > 0 && (atual.length >= SENTENCAS_POR_LOTE || bytes + s.sql.length > BYTES_POR_LOTE)) {
      saida.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(s);
    bytes += s.sql.length;
  }
  if (atual.length > 0) saida.push(atual);
  return saida;
}

/** Tag de cifrão que não aparece no texto — para embrulhar a sentença sem escapar nada. */
function tagLivre(prefixo: string, texto: string): string {
  for (;;) {
    const tag = `$${prefixo}_${randomBytes(4).toString("hex")}$`;
    if (!texto.includes(tag)) return tag;
  }
}

/**
 * A sentença dentro de um DO com EXCEPTION: se ela falhar, a falha vira NOTICE
 * (com a linha do arquivo) e o lote segue. É o "psql sem ON_ERROR_STOP" sem
 * pagar uma ida ao banco por sentença.
 */
function embrulhar(s: Sentenca): string {
  const tagSql = tagLivre("sentenca", s.sql);
  const tagDo = tagLivre("bloco", s.sql + tagSql);
  return (
    `do ${tagDo} begin execute ${tagSql}${s.sql}${tagSql}; ` +
    `exception when others then raise notice 'aplicar-baseline|${s.linha}|%', sqlerrm; end ${tagDo};`
  );
}

async function esperar(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function aplicarInstall(cliente: pg.Client, grupos: Sentenca[][]): Promise<Erro | null> {
  for (const [k, grupo] of grupos.entries()) {
    try {
      // Várias sentenças numa consulta = uma transação implícita: o lote entra inteiro ou nada.
      await cliente.query(grupo.map((s) => `${s.sql};`).join("\n"));
    } catch {
      // O lote voltou atrás. Uma por uma, para achar QUAL sentença falha e parar nela.
      for (const s of grupo) {
        try {
          await cliente.query(s.sql);
        } catch (err) {
          return { linha: s.linha, mensagem: err instanceof Error ? err.message : String(err) };
        }
      }
    }
    progresso(k + 1, grupos.length);
  }
  return null;
}

async function aplicarUpdate(cliente: pg.Client, grupos: Sentenca[][], erros: Erro[]): Promise<void> {
  cliente.on("notice", (msg) => {
    const m = /^aplicar-baseline\|(\d+)\|([\s\S]*)$/.exec(msg.message ?? "");
    if (m) erros.push({ linha: Number(m[1]), mensagem: m[2]! });
  });
  for (const [k, grupo] of grupos.entries()) {
    const consulta = grupo.map(embrulhar).join("\n");
    for (let tentativa = 1; ; tentativa++) {
      const antes = erros.length;
      try {
        await cliente.query(consulta);
        break;
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        erros.length = antes; // os avisos de um lote que voltou atrás não valem
        if (tentativa >= TENTATIVAS_POR_LOTE || !ERROS_DE_DISPUTA.test(mensagem)) throw err;
        console.warn(`\n  ⚠ lote ${k + 1}: ${mensagem} — repitiendo (intento ${tentativa + 1} de ${TENTATIVAS_POR_LOTE})`);
        await esperar(5000 * tentativa);
      }
    }
    progresso(k + 1, grupos.length);
  }
}

function progresso(feitos: number, total: number): void {
  if (feitos === total || feitos % 10 === 0) {
    process.stdout.write(`\r  ${feitos}/${total} lotes (${Math.round((feitos / total) * 100)}%)`);
  }
  if (feitos === total) process.stdout.write("\n");
}

/**
 * O que prova que o arquivo chegou ao FIM no banco: objetos dos últimos blocos
 * do apêndice. Foram exatamente estes que faltaram na base aplicada pelo editor.
 */
const VERIFICACOES: ReadonlyArray<{ nome: string; sql: string }> = [
  {
    nome: "columna crm_stages.avisar_na_central (0440)",
    sql: `select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'crm_stages' and column_name = 'avisar_na_central'`,
  },
  { nome: "bucket org-sounds (0441)", sql: `select 1 from storage.buckets where id = 'org-sounds'` },
  {
    nome: "trigger trg_aviso_da_central_criado (0442)",
    sql: `select 1 from pg_trigger where tgname = 'trg_aviso_da_central_criado' and not tgisinternal`,
  },
  {
    nome: "modelo gpt-4.1-mini por defecto (0443)",
    sql: `select 1 from public.ai_models where provider = 'openai' and model_id = 'gpt-4.1-mini' and is_default_for_provider`,
  },
  {
    nome: "embudo por defecto en el idioma de la organización (0444)",
    sql: `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'fn_seed_default_pipeline_for_org'
             and p.prosrc like '%Carrito abandonado%'`,
  },
  {
    // Es la ÚLTIMA sentencia del archivo: si está, el pegado llegó hasta el final.
    nome: "skills de plataforma en español (0445)",
    sql: `select 1 from public.skill_pointers p join public.skill_versions v on v.id = p.version_id
           where p.organization_id is null and p.name = 'agendamento' and v.description like 'Guía para agendar%'`,
  },
];

async function conferir(cliente: pg.Client): Promise<string[]> {
  const faltando: string[] = [];
  for (const v of VERIFICACOES) {
    try {
      const r = await cliente.query(v.sql);
      if (r.rowCount === 0) faltando.push(v.nome);
    } catch {
      faltando.push(v.nome);
    }
  }
  return faltando;
}

/**
 * A chave com que a base cifra segredos (o do webhook do Zernio, entre outros).
 * O kit a semeia logo depois do baseline (`ensure_encryption_key`); sem ela,
 * conectar o canal falha com "cifrado no disponible". Com
 * `NUVEMSHOP_OAUTH_ENCRYPTION_KEY` no ambiente, vale a do ambiente (como no
 * kit); sem ela, só cria se ainda não houver — uma chave existente nunca é
 * trocada, porque isso tornaria ilegível o que já foi cifrado.
 */
async function semearChaveDeCifra(cliente: pg.Client): Promise<void> {
  const daEnv = process.env.NUVEMSHOP_OAUTH_ENCRYPTION_KEY?.trim();
  if (daEnv) {
    await cliente.query(
      `insert into private.app_secrets (name, value) values ('nuvemshop_oauth_key', $1)
       on conflict (name) do update set value = excluded.value, updated_at = now()`,
      [daEnv],
    );
    return;
  }
  await cliente.query(
    `insert into private.app_secrets (name, value)
     values ('nuvemshop_oauth_key', encode(extensions.gen_random_bytes(32), 'hex'))
     on conflict (name) do nothing`,
  );
}

async function main(): Promise<void> {
  const url = urlDaBase();
  if (!existsSync(BASELINE)) {
    console.error(`✗ No se encontró ${BASELINE}`);
    process.exit(1);
  }
  const sentencas = dividirSql(readFileSync(BASELINE, "utf8"));
  const grupos = lotes(sentencas);

  const cliente = new pg.Client({
    connectionString: url,
    // Supabase exige TLS; o certificado do pooler não vem na cadeia do Node.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  console.info(`\n→ Conectando a ${ondeConecta(url)}…`);
  await cliente.connect();
  await cliente.query("set statement_timeout = 0");

  if (process.argv.includes("--solo-verificar")) {
    const faltando = await conferir(cliente);
    await cliente.end();
    if (faltando.length > 0) {
      console.error("\n✗ Instalación INCOMPLETA. Faltan en la base:");
      for (const f of faltando) console.error(`  - ${f}`);
      console.error("  Corré `pnpm db:aplicar` para completar (es idempotente).");
      process.exit(1);
    }
    console.info("\n✓ La base tiene los objetos del último bloque del baseline.");
    return;
  }

  const { rows } = await cliente.query<{ existe: boolean }>(
    "select to_regclass('public.organizations') is not null as existe",
  );
  const forcado = argumento("modo");
  const modo: Modo = forcado === "install" || forcado === "update" ? forcado : rows[0]?.existe ? "update" : "install";
  console.info(
    `→ Modo ${modo} (${modo === "install" ? "base vacía: se detiene en el primer error" : "base existente: re-aplica, ignora 'already exists'"})`,
  );
  console.info(`→ ${sentencas.length} sentencias en ${grupos.length} lotes`);

  const inicio = Date.now();
  let falhou = false;
  const erros: Erro[] = [];
  try {
    if (modo === "install") {
      const erro = await aplicarInstall(cliente, grupos);
      if (erro) {
        falhou = true;
        console.error(`\n✗ Error en supabase/baseline.sql, línea ${erro.linha}:\n  ${erro.mensagem}`);
        console.error("  Nada después de esa línea se aplicó. Corregí la causa y volvé a correr el comando.");
      }
    } else {
      await aplicarUpdate(cliente, grupos, erros);
    }
  } catch (err) {
    falhou = true;
    console.error(`\n✗ La aplicación se cortó antes del final: ${err instanceof Error ? err.message : String(err)}`);
    console.error("  Es seguro volver a correr el comando (el baseline es idempotente).");
  }
  console.info(`→ ${((Date.now() - inicio) / 1000).toFixed(1)} s`);

  const inesperados = erros.filter((e) => !ERROS_BENIGNOS.test(e.mensagem));
  if (modo === "update") {
    console.info(`→ ${erros.length - inesperados.length} avisos esperados ('already exists' y similares)`);
    if (inesperados.length > 0) {
      console.warn(`\n⚠ ${inesperados.length} errores NO esperados (primeros 15):`);
      for (const e of inesperados.slice(0, 15)) console.warn(`  línea ${e.linha}: ${e.mensagem}`);
    }
  }

  if (!falhou) {
    try {
      await semearChaveDeCifra(cliente);
      console.info("→ Clave de cifrado de secretos lista");
    } catch (err) {
      console.warn(`⚠ No se pudo sembrar la clave de cifrado: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const faltando = await conferir(cliente);
  await cliente.end();

  if (faltando.length > 0) {
    console.error("\n✗ Instalación INCOMPLETA. Faltan en la base:");
    for (const f of faltando) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (falhou || inesperados.length > 0) {
    console.warn("\n⚠ Los objetos del final del baseline están, pero hubo errores arriba. Revisalos antes de seguir.");
    process.exit(1);
  }
  console.info("\n✓ Instalación completa: el baseline se aplicó hasta el final y la base tiene los objetos del último bloque.");
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
