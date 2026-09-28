export function textoSemRef(template: string): string {
  return template
    .replace(/\s*\[[^[\]]*\{token\}[^[\]]*\]/g, "")
    .replaceAll("{token}", "")
    .trim();
}
