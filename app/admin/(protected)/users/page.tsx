import { UsersClient } from "./_client";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Usuários — Admin Plataforma") };

export default function AdminUsersPage() {
  return <UsersClient />;
}
