import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 1. Obtener la connection string de argumentos o de variables de entorno
let connectionString = process.argv[2];

if (!connectionString) {
  const envLocalPath = path.join(rootDir, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, "utf-8");
    // SUPABASE_DB_URL es la que ya exigen la app y el worker; DATABASE_URL queda por compatibilidad.
    const match =
      envContent.match(/^SUPABASE_DB_URL\s*=\s*["']?([^"'\r\n]+)["']?/m) ||
      envContent.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);
    if (match && match[1]) {
      connectionString = match[1].trim();
    }
  }
}

if (!connectionString) {
  console.error("\n❌ Error: No se proporcionó la cadena de conexión de Supabase.");
  console.log("\nUso:");
  console.log('  node scripts/migrar-supabase.js "postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"\n');
  console.log("O agrega en tu archivo .env.local (Supabase > Connect > Session pooler):");
  console.log('  SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"\n');
  process.exit(1);
}

// Si la contraseña contiene @ sin codificar, corregirla automáticamente
// postgres://user:pass@word@host -> postgres://user:pass%40word@host
if (connectionString.includes("@@")) {
  connectionString = connectionString.replace("@@", "%40@");
}

const baselinePath = path.join(rootDir, "supabase", "baseline.sql");
if (!fs.existsSync(baselinePath)) {
  console.error(`\n❌ Error: No se encontró el archivo ${baselinePath}`);
  process.exit(1);
}

const { Client } = pg;
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("\n🚀 Iniciando configuración de base de datos para Atiendo CRM...");
  console.log("📡 Conectando a Supabase PostgreSQL...");

  try {
    await client.connect();
    console.log("✅ Conexión establecida exitosamente.");

    // Paso 1: Extensiones requeridas
    console.log("📦 Verificando y creando extensiones requeridas...");
    await client.query(`
      create extension if not exists "uuid-ossp";
      create extension if not exists pgcrypto;
      create extension if not exists vector;
      create extension if not exists citext;
      create extension if not exists pg_trgm;
    `);
    console.log("✅ Extensiones habilitadas (uuid-ossp, pgcrypto, vector, citext, pg_trgm).");

    // Paso 2: Proteger y aislar tablas prototipo previas que puedan colisionar con la arquitectura multi-tenant
    console.log("🛡️ Comprobando aislamiento de esquema...");
    // Solo en una base con tablas de un prototipo anterior. Si el CRM ya está
    // instalado (existe public.organizations), esas tablas SON las del CRM y
    // moverlas a legacy_backup dejaría la app sin contactos ni conversaciones.
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS legacy_backup;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations') THEN
          RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
          ALTER TABLE public.messages SET SCHEMA legacy_backup;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations') THEN
          ALTER TABLE public.conversations SET SCHEMA legacy_backup;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contacts') THEN
          ALTER TABLE public.contacts SET SCHEMA legacy_backup;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_deals') THEN
          ALTER TABLE public.pipeline_deals SET SCHEMA legacy_backup;
        END IF;
      END $$;
    `);
    console.log("✅ Esquema listo para aplicar la arquitectura oficial.");

    // Paso 3: Leer y aplicar baseline.sql
    console.log("📄 Leyendo archivo supabase/baseline.sql (40.000 líneas)...");
    const sql = fs.readFileSync(baselinePath, "utf-8");

    console.log("⏳ Aplicando esquema completo en Supabase (esto puede demorar entre 15 y 45 segundos)...");
    await client.query(sql);

    // Paso 4: clave con la que la base cifra los secretos (p. ej. el del webhook
    // de Zernio). El instalador oficial la siembra; sin ella, conectar Zernio
    // falla con "cifrado no disponible". Una clave existente no se toca.
    await client.query(`
      insert into private.app_secrets (name, value)
      values ('nuvemshop_oauth_key', encode(extensions.gen_random_bytes(32), 'hex'))
      on conflict (name) do nothing;
    `);
    console.log("🔐 Clave de cifrado de secretos lista.");

    console.log("\n🎉 ¡Base de datos de Atiendo CRM inicializada con ÉXITO TOTAL!");
    console.log("===============================================================");
    console.log("Todas las tablas, triggers, funciones y políticas RLS han sido creadas.");
    console.log("Siguiente paso: pnpm build y luego pnpm demo\n");
  } catch (error) {
    console.error("\n❌ Error al ejecutar el script en Supabase:");
    console.error(error.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
