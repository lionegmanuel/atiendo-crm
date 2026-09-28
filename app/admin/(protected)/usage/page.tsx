import { UsageClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Uso & Custo — Admin Plataforma") };

export default function AdminUsagePage() {
  return <UsageClient />;
}
