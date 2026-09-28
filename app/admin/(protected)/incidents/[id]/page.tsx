import { IncidentDetailClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Detalhe do Incidente — Admin Plataforma") };

export default async function AdminIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetailClient id={id} />;
}
