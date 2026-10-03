import { redirect } from "next/navigation";

/**
 * `/app/ai/knowledge` no es pantalla: el conocimiento vive en `/sources`. Sin
 * esta página, quien escribía la ruta "corta" (o la recortaba del navegador)
 * caía en un 404.
 */
export default function KnowledgePage(): never {
  redirect("/app/ai/knowledge/sources");
}
