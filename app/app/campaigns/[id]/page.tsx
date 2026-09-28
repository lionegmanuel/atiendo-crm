import type { Metadata } from "next";

import { DetalheDaCampanha } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const dynamic = "force-dynamic";
export const metadata = { title: tituloNoIdiomaDaInstalacao("Campanha") };

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalheDaCampanha id={id} />;
}
