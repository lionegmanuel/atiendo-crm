/**
 * Faz login real via Supabase no app local e segue os redirects pra ver onde a
 * sessão pra `email` cai quando vai pra /app/inbox.
 * Run: npx tsx scripts/probe-redirect.ts <email> <password>
 */
import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

async function main() {
  const env = carregarEnvLocal();
  const email = process.argv[2] ?? "demo@deskcomm.com.br";
  const password = process.argv[3] ?? "Demo!Live2026";

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("login failed:", error?.message);
    process.exit(1);
  }
  console.log("✓ login ok, user:", data.user.id);

  // Cookie format que o @supabase/ssr usa
  const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const session = data.session;
  // ssr usa cookie chunked json — vamos fingir um base64 simples (pode falhar)
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      token_type: "bearer",
      user: data.user,
    }),
  );

  const targets = ["/app/inbox", "/onboarding"];
  for (const path of targets) {
    const res = await fetch(`http://localhost:3000${path}`, {
      method: "GET",
      redirect: "manual",
      headers: { cookie: `${cookieName}=${cookieValue}` },
    });
    console.log(`\nGET ${path} →`);
    console.log("  status:", res.status);
    console.log("  location:", res.headers.get("location"));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
