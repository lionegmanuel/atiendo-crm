/**
 * Imagem colada no composer (Ctrl/Cmd+V), padrão WhatsApp.
 *
 * A decisão de "isto é uma colagem de imagem ou de texto?" vive aqui, fora do
 * componente, porque é a parte que erra: um handler que intercepta cedo demais
 * quebra o Ctrl+V de texto — que é o uso comum do campo — e o defeito só
 * aparece em produção, com o vendedor no meio de um atendimento.
 *
 * Regra: só é colagem de imagem quando existe MESMO um arquivo de imagem no
 * clipboard. Copiar texto nunca produz arquivo, então texto continua passando
 * direto pro browser.
 */

/** Extensão canônica por mime — espelha o mapa de `lib/messaging/media/types`. */
const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function ehImagem(tipo: string | undefined): boolean {
  return !!tipo && tipo.split(";")[0]!.trim().toLowerCase().startsWith("image/");
}

/**
 * Extrai a imagem de um clipboard, ou `null` se não houver uma.
 *
 * Lê `files` E `items`: nem todo browser popula os dois. Chrome preenche
 * `files` num print de tela; Firefox, em alguns casos, só expõe o `item` do
 * tipo `file`. Ler apenas um deles faz a colagem "não funcionar" num browser
 * e funcionar no outro — o tipo de bug que ninguém reproduz.
 *
 * @param carimbo instante usado para nomear o arquivo. Entra por parâmetro
 *   para o teste ser determinístico: um print colado chega sem nome útil
 *   ("image.png" em toda colagem), e um nome com horário é o que deixa o
 *   anexo rastreável depois, na lista de mídia da conversa.
 */
export function imagemDoClipboard(dados: DataTransfer | null, carimbo: Date): File | null {
  if (!dados) return null;

  const daLista = Array.from(dados.files ?? []).find((f) => ehImagem(f.type));
  const dosItens = daLista
    ? null
    : Array.from(dados.items ?? [])
        .filter((i) => i.kind === "file" && ehImagem(i.type))
        .map((i) => i.getAsFile())
        .find((f): f is File => f !== null);

  const arquivo = daLista ?? dosItens ?? null;
  // Arquivo de 0 byte existe (colagem de uma referência que o browser não
  // conseguiu materializar) e subiria só para o servidor recusar com
  // "Arquivo vazio" — melhor tratar como "não havia imagem" e deixar o
  // Ctrl+V seguir seu caminho normal.
  if (!arquivo || arquivo.size <= 0) return null;

  return new File([arquivo], nomeDaColagem(arquivo, carimbo), {
    type: arquivo.type,
    lastModified: arquivo.lastModified,
  });
}

/**
 * Nome para o arquivo colado.
 *
 * Preserva o nome quando ele existe e é real (arrastar/copiar um arquivo do
 * sistema traz "orcamento.png"); só inventa quando o browser entregou o nome
 * genérico de print de tela, que é o caso de toda colagem de captura.
 */
function nomeDaColagem(arquivo: File, carimbo: Date): string {
  const generico = !arquivo.name || /^image\.[a-z0-9]+$/i.test(arquivo.name);
  if (!generico) return arquivo.name;

  const ext = EXT_POR_MIME[arquivo.type.split(";")[0]!.trim().toLowerCase()] ?? "png";
  const iso = carimbo.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `imagem-colada-${iso}.${ext}`;
}
