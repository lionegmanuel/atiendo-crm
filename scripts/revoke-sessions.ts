/**
 * Revoga TODAS as sessões ativas de um user via admin API. Força re-login.
 * Run: npx tsx scripts/revoke-sessions.ts <email>
 */
import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

async function main() {
  const env = carregarEnvLocal();
  const a = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = process.argv[2];
  if (!email) { console.error("usage: tsx scripts/revoke-sessions.ts <email>"); process.exit(1); }
  const { data: u } = await a.auth.admin.listUsers({ perPage: 200 });
  const user = u.users.find((x) => x.email === email);
  if (!user) { console.error("not found"); process.exit(1); }
  const { error } = await a.auth.admin.signOut(user.id, "global");
  if (error) { console.error("signout failed:", error.message); process.exit(1); }
  console.log(`✓ todas as sessões do ${email} revogadas (user_id=${user.id})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
