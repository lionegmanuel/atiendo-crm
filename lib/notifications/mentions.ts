export function tokensDeMencao(body: string): string[] {
  const hits = body.match(/@[\p{L}\p{N}._-]+/gu) ?? [];
  return hits.map((t) => t.slice(1).toLowerCase());
}

export function mencaoAtingeUsuario(
  body: string,
  user: { id: string; email: string; full_name: string | null },
): boolean {
  const tokens = tokensDeMencao(body);
  if (tokens.length === 0) return false;
  if (tokens.includes(user.id.toLowerCase())) return true;
  const email = user.email.trim().toLowerCase();
  if (!email) return false;
  const local = email.split("@")[0] ?? "";
  if (tokens.includes(email) || (local && tokens.includes(local))) return true;
  const name = user.full_name?.trim().toLowerCase() ?? "";
  if (!name) return false;
  const first = name.split(/\s+/)[0] ?? "";
  const slug = name.replace(/\s+/g, "");
  return tokens.includes(first) || tokens.includes(slug);
}
