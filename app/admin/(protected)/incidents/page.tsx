import { IncidentsClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Incidentes — Admin Plataforma") };

export default function AdminIncidentsPage() {
  return <IncidentsClient />;
}
