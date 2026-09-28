import { redirect } from "next/navigation";

/**
 * Rota antiga, mantida como REDIRECIONAMENTO — template só existe por causa do canal oficial — vive como sub-aba dele.
 *
 * Não é gordura: é o que impede que todo link salvo, print de tutorial ou aba
 * aberta de quem já usava o sistema vire um 404 depois da mudança. Apagar a rota
 * economizaria um arquivo e cobraria isso do usuário.
 */
export default function Page(): never {
  redirect("/app/connections?aba=oficial&sub=templates");
}
