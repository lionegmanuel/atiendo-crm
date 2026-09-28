import { ChatCircle } from "@/lib/ui/icons";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export default async function AdminInboxIndexPage() {
  const { user } = await requirePlatformAdmin();
  const idioma = normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <ChatCircle size={40} weight="duotone" className="opacity-40" aria-hidden />
      <p className="text-sm font-medium">{traduzir("Selecione uma conversa para visualizar", idioma)}</p>
      <p className="max-w-xs text-xs opacity-70">
        {traduzir(
          "Modo somente-leitura. Use “Impersonate” para responder como atendente do tenant.",
          idioma,
        )}
      </p>
    </div>
  );
}
