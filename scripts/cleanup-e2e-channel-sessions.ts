import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste, destinoEhLocal } from "./lib/env-de-teste";
import { NOMES_DE_SESSAO_E2E } from "./lib/sessoes-e2e";

interface OpcoesDeLimpeza {
  allowRemote?: boolean;
}

export async function limparSessoesDeCanalE2E(
  opcoes: OpcoesDeLimpeza = {},
): Promise<{ removidas: number }> {
  const credenciais = credenciaisSupabaseDeTeste();
  anunciarDestino("cleanup-e2e-channel-sessions", credenciais);

  if (!destinoEhLocal(credenciais.url) && !opcoes.allowRemote) {
    throw new Error(
      `cleanup-e2e-channel-sessions recusou Supabase remoto (${credenciais.url}). ` +
        "O teardown automático só limpa o E2E local. Para remover resíduo antigo de uma instalação, rode de propósito com --allow-remote.",
    );
  }

  const admin = createClient(credenciais.url, credenciais.serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: sessoes, error: buscaErro } = await admin
    .from("channel_sessions")
    .select("id, organization_id, waha_session_name")
    .in("waha_session_name", [...NOMES_DE_SESSAO_E2E]);

  if (buscaErro) throw new Error(`listar channel_sessions E2E: ${buscaErro.message}`);
  const ids = (sessoes ?? []).map((s) => s.id as string);
  if (ids.length === 0) return { removidas: 0 };

  const { error: conversasErro } = await admin
    .from("conversations")
    .delete()
    .in("channel_session_id", ids);
  if (conversasErro) throw new Error(`apagar conversations E2E: ${conversasErro.message}`);

  const { error: saudeErro } = await admin
    .from("channel_session_health")
    .delete()
    .in("channel_session_id", ids);
  if (saudeErro) throw new Error(`apagar channel_session_health E2E: ${saudeErro.message}`);

  const { error: sessoesErro } = await admin.from("channel_sessions").delete().in("id", ids);
  if (sessoesErro) throw new Error(`apagar channel_sessions E2E: ${sessoesErro.message}`);

  return { removidas: ids.length };
}

async function main(): Promise<void> {
  const allowRemote = process.argv.includes("--allow-remote");
  const resultado = await limparSessoesDeCanalE2E({ allowRemote });
  console.info(`✅ Sessões de canal E2E removidas: ${resultado.removidas}`);
}

// `require.main === module` e nao `import.meta.url`: este arquivo deixou de ser
// so um CLI — o `tests/e2e/global-teardown.ts` o IMPORTA, e o Playwright transpila
// o teardown para CommonJS, onde `import.meta` e erro de SINTAXE. O sintoma não é
// o teardown falhar: os 134 testes passam, o teardown estoura depois deles, e a
// rodada inteira sai com exit 1 sob a linha "1 error was not a part of any test".
//
// A forma escolhida tem precedente medido no repo: `scripts/cortar-release.ts` usa
// a mesma guarda e é invocado por `tsx` em `release:conferir`, que roda no CI.
// Controle rodado nos dois ramos: sob `tsx`, executar o arquivo direto entra no
// if, e importá-lo não entra.
if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Limpeza de sessões E2E falhou:", err);
    process.exit(1);
  });
}
