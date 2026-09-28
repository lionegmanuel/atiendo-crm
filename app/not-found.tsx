import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

export default async function NotFound() {
  // Rota fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider`, então
  // resolve o idioma direto, como `admin/forbidden/page.tsx`. Pode chegar aqui
  // sem sessão (link quebrado, robô), por isso `user` é opcional.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold">
          {traduzir("404 — Página não encontrada", idioma)}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {traduzir("Verifique o link ou volte pra inbox.", idioma)}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/">{traduzir("Voltar", idioma)}</Link>
          </Button>
          <Button asChild>
            <Link href="/app/inbox">{traduzir("Voltar pra Inbox", idioma)}</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
