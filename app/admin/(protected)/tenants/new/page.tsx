import { NewTenantForm } from "./_form";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Novo Tenant — Admin Plataforma") };

export default function NewTenantPage() {
  return <NewTenantForm />;
}
