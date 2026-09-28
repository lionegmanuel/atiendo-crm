import { PlatformAdminsClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Platform Admins — Admin Plataforma") };

export default function AdminPlatformAdminsPage() {
  return <PlatformAdminsClient />;
}
