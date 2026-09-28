import type { Metadata } from "next";
import { ContactsListClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const dynamic = "force-dynamic";
export const metadata = { title: tituloNoIdiomaDaInstalacao("Contatos") };

export default function ContactsPage() {
  return <ContactsListClient />;
}
