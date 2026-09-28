import type { Metadata } from "next";

import { NovaCampanha } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const dynamic = "force-dynamic";
export const metadata = { title: tituloNoIdiomaDaInstalacao("Nova campanha") };

export default function NovaCampanhaPage() {
  return <NovaCampanha />;
}
