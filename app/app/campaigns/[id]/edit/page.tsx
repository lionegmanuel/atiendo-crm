import type { Metadata } from "next";

import { EditarCampanha } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const dynamic = "force-dynamic";
export const metadata = { title: tituloNoIdiomaDaInstalacao("Editar campanha") };

export default async function EditarCampanhaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditarCampanha id={id} />;
}
