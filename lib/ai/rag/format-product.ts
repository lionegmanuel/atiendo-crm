/**
 * Formats a Nuvemshop product into a plain-text document suitable for RAG embedding.
 *
 * Strips HTML from descriptions and produces a labeled, human-readable template
 * that embeds well for semantic search.
 */

export interface NuvemshopProductVariant {
  price?: string;
  sku?: string;
}

export interface NuvemshopProduct {
  id: string;
  name: { pt: string } | string;
  description?: string;
  price?: string;
  sku?: string;
  permalink?: string;
  variants?: NuvemshopProductVariant[];
  categories?: Array<{ name: { pt: string } | string }>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function resolveName(name: { pt: string } | string | undefined): string {
  if (!name) return "";
  if (typeof name === "string") return name;
  return name.pt ?? "";
}

/**
 * Converts a Nuvemshop product object into a plain-text RAG document.
 */
export function formatProductForRag(product: NuvemshopProduct): string {
  const name = resolveName(product.name);
  const description = product.description ? stripHtml(product.description) : "";
  const price = product.price ? `R$ ${product.price}` : "N/A";
  const sku = product.sku ?? "N/A";
  const permalink = product.permalink ?? "";

  const variants =
    product.variants && product.variants.length > 0
      ? product.variants
          .map((v) => {
            const parts: string[] = [];
            if (v.price) parts.push(`Preço: R$ ${v.price}`);
            if (v.sku) parts.push(`SKU: ${v.sku}`);
            return parts.join(", ");
          })
          .filter((v) => v.length > 0)
          .join(" | ")
      : "N/A";

  const categories =
    product.categories && product.categories.length > 0
      ? product.categories.map((c) => resolveName(c.name)).join(", ")
      : "N/A";

  const lines: string[] = [
    `Produto: ${name}`,
    `Descrição: ${description || "N/A"}`,
    `Preço: ${price}`,
    `Variantes: ${variants}`,
    `Categorias: ${categories}`,
    `SKU: ${sku}`,
  ];

  if (permalink) {
    lines.push(`Link: ${permalink}`);
  }

  return lines.join("\n");
}
