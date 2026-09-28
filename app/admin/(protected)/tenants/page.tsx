import { TenantsClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Tenants — Admin Plataforma") };

export default function AdminTenantsPage() {
  return <TenantsClient />;
}
