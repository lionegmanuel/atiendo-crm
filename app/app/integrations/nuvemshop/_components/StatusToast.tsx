"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Integração não configurada — configure as credenciais em .env.local.",
  invalid_state: "Sessão de autorização expirou. Tente novamente.",
  missing_code: "Resposta da Nuvemshop incompleta — code ausente.",
  token_exchange_failed: "Não foi possível trocar o code pelo access token.",
  invalid_token_response: "Resposta inesperada da Nuvemshop.",
  network_error: "Falha de rede ao contatar a Nuvemshop.",
  encrypt_failed: "Falha ao criptografar o token. Verifique NUVEMSHOP_OAUTH_ENCRYPTION_KEY.",
  db_upsert_failed: "Falha ao gravar a integração no banco.",
};

export function StatusToast() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const ok = params.get("ok");
    const error = params.get("error");
    if (!ok && !error) return;
    handled.current = true;

    if (ok) {
      toast.success(t("Nuvemshop conectada com sucesso."));
    } else if (error) {
      toast.error(t(ERROR_MESSAGES[error] ?? `Erro: ${error}`));
    }

    // Strip the query params so reload doesn't replay the toast.
    router.replace("/app/integrations/nuvemshop");
  }, [params, router, t]);

  return null;
}
