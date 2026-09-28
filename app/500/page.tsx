import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

/**
 * `/500` — irmã de `/403` e `/503`, e faltava.
 *
 * `lib/auth/public-paths.ts` já isenta esta rota de auth desde sempre: o
 * sistema contava com a página. Sem ela, quem caísse aqui (proxy, link de
 * runbook, redirect de borda) via "página não encontrada" — a mensagem errada
 * sobre o que aconteceu.
 *
 * Distinta de `app/error.tsx`, que trata exceção em runtime dentro do React.
 * Esta é a página estática, alcançável por URL.
 */
export default async function InternalErrorPage() {
  // Rota fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider`, então
  // resolve o idioma direto, como `admin/forbidden/page.tsx`. Quem cai aqui
  // pode até ser o próprio Supabase falhando, por isso `user` é opcional e a
  // ausência de sessão não impede a página de renderizar.
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
        <h1 className="text-2xl font-semibold">{traduzir("500 — Erro interno", idioma)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {traduzir(
            "Algo quebrou do nosso lado. Já registramos o ocorrido; tente de novo em instantes.",
            idioma,
          )}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href="/">{traduzir("Voltar", idioma)}</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
