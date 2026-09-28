import { DashboardClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Dashboard — Admin Plataforma") };

export default function AdminDashboardPage() {
  return <DashboardClient />;
}
