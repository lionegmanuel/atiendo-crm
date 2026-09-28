import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

async function main() {
  const env = carregarEnvLocal();
  const a = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!,{ auth:{autoRefreshToken:false,persistSession:false}});
  const email = process.argv[2] ?? "demo@deskcomm.com.br";
  const { data: u } = await a.auth.admin.listUsers({ perPage: 200 });
  const user = u.users.find((x) => x.email === email);
  if (!user) { console.error("not found"); process.exit(1); }
  console.log("user:", user.id, user.email);
  const { data: m } = await a.from("user_organizations").select("organization_id, role, revoked_at, accepted_at").eq("user_id", user.id);
  console.log("memberships:", JSON.stringify(m, null, 2));
  const orgIds = (m as Array<{organization_id:string}>|null)?.map((x)=>x.organization_id) ?? [];
  const { data: orgs } = await a.from("organizations").select("id, slug, display_name, onboarded_at, status").in("id", orgIds);
  console.log("orgs:", JSON.stringify(orgs, null, 2));
  const { data: pa } = await a.from("platform_admins").select("user_id, mfa_required").eq("user_id", user.id);
  console.log("platform_admin:", pa);
}
main().catch((e)=>{console.error(e);process.exit(1);});
