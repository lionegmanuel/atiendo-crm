import Link from "next/link";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = {
  title: "Conta suspensa",
};

/**
 * Esta tela entregava o NOSSO endereço de suporte ao cliente de um revendedor —
 * e aqui isso é ativamente errado: quem suspendeu a conta foi o revendedor, e
 * escrever para nós não desbloqueia nada. O endereço agora sai de
 * `SUPPORT_EMAIL` (o do operador) e, quando ninguém configurou, o parágrafo do
 * contato simplesmente NÃO renderiza. Cair de volta num endereço do produto
 * seria o defeito de volta, com o agravante de parecer resolvido.
 */
export default async function AccountSuspendedPage() {
  const suporte = await emailDeSuporte();
  // Rota fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider`, então
  // resolve o idioma direto, como `admin/forbidden/page.tsx`. Quem chega aqui
  // normalmente tem sessão do Supabase Auth (a suspensão é regra do produto,
  // não um ban de autenticação), mas `user` fica opcional por segurança.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold">{traduzir("Conta suspensa", idioma)}</h1>
        {suporte ? (
          <p className="text-sm text-muted-foreground">
            {traduzir("Sua conta está suspensa. Entre em contato com", idioma)}{" "}
            <a
              href={`mailto:${suporte}`}
              className="underline underline-offset-4 hover:text-foreground transition-colors"
            >
              {suporte}
            </a>{" "}
            {traduzir("para mais informações.", idioma)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {traduzir(
              "Sua conta está suspensa. Fale com quem administra este sistema para saber o motivo e como reativá-la.",
              idioma,
            )}
          </p>
        )}
        <div className="pt-2">
          <Button asChild variant="outline">
            <Link href="/login">{traduzir("Sair", idioma)}</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
