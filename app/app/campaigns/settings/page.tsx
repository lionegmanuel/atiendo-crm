import type { Metadata } from "next";

import { ConfiguracaoDeCampanhas } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const dynamic = "force-dynamic";
export const metadata = { title: tituloNoIdiomaDaInstalacao("Configuração de campanhas") };

export default function ConfiguracaoDeCampanhasPage() {
  return <ConfiguracaoDeCampanhas />;
}
