"use server";
/**
 * Server actions thin para a tela de credentials. A lógica pesada (AES-GCM
 * encrypt + async provider validation) vive nas rotas REST `/api/v1/ai/credentials/*`
 * e o cliente usa `apiClient` direto. Esta action existe apenas para revalidar
 * o `usage_map` rendered no Server Component após mutations.
 */
import { revalidatePath } from "next/cache";

export async function refreshCredentialsView() {
  revalidatePath("/app/ai/credentials");
}
