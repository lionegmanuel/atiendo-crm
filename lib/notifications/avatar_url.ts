/** A bandeja do Windows busca o ícone sem cookie — URL autenticada não serve. */
export function avatarUrlServivel(finalUrl: string, origin: string): string | undefined {
  try {
    const u = new URL(finalUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.origin === origin && u.pathname.includes("/api/v1/contacts/")) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
