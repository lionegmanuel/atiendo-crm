"use client";
/**
 * Os sons dos avisos da Central — a etapa que avisa e o pedido de pessoa.
 * Ver `lib/notifications/sons-da-org.ts` e `app/api/v1/settings/sons`.
 *
 * Todo membro ouve e vê qual som está valendo; trocar e voltar ao do sistema é
 * de `manager` para cima (a mesma régua da rota). Quem não pode trocar não vê
 * o botão — um botão que devolve 403 é uma promessa falsa.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ROLE_RANK } from "@/lib/auth/types";
import { playSound } from "@/lib/notifications/sounds";
import { SOM_PADRAO, TIPOS_DE_SOM, type TipoDeSom } from "@/lib/notifications/sons-da-org";

const ROTULO: Record<TipoDeSom, { titulo: string; quando: string }> = {
  venda: {
    titulo: "Etapa que avisa",
    quando:
      "Quando um negócio entra numa etapa marcada para avisar na Central (por exemplo, o pedido confirmado).",
  },
  pessoa: {
    titulo: "Precisa de uma pessoa",
    quando: "Quando o assistente passa a conversa para alguém da equipe, ou fica sem saldo no provedor de IA.",
  },
};

export function SonsDosAvisos() {
  const t = useT();
  const qc = useQueryClient();
  const { user, activeOrg } = useAuth();
  const podeTrocar =
    (user.is_platform_admin && !user.support) ||
    (activeOrg !== null && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager);
  const [enviando, setEnviando] = React.useState<TipoDeSom | null>(null);
  const { data: urls } = useQuery({
    queryKey: ["settings-sons"],
    queryFn: () =>
      apiClient.get<{ data: Record<TipoDeSom, string | null> }>("/api/v1/settings/sons").then((r) => r.data),
  });

  function ouvir(tipo: TipoDeSom) {
    const url = urls?.[tipo];
    if (url) void new Audio(url).play().catch(() => playSound(SOM_PADRAO[tipo]));
    else playSound(SOM_PADRAO[tipo]);
  }

  async function enviar(tipo: TipoDeSom, arquivo: File) {
    setEnviando(tipo);
    try {
      const form = new FormData();
      form.append("tipo", tipo);
      form.append("arquivo", arquivo);
      const res = await fetch("/api/v1/settings/sons", { method: "POST", body: form });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(corpo?.error?.message ?? t("Erro ao subir o som."));
      }
      toast.success(t("Som salvo"));
      await qc.invalidateQueries({ queryKey: ["settings-sons"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Erro ao subir o som."));
    } finally {
      setEnviando(null);
    }
  }

  async function remover(tipo: TipoDeSom) {
    try {
      await apiClient.delete(`/api/v1/settings/sons?tipo=${tipo}`);
      toast.success(t("Voltou ao som do sistema"));
      await qc.invalidateQueries({ queryKey: ["settings-sons"] });
    } catch (e) {
      showApiError(e);
    }
  }

  return (
    <Card className="p-4" data-testid="sons-dos-avisos">
      <h2 className="text-base font-semibold">{t("Sons dos avisos")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("Tocam com o site aberto quando o aviso chega na Central. MP3, OGG ou WAV de até 1 MB.")}
      </p>
      <ul className="divide-y">
        {TIPOS_DE_SOM.map((tipo) => (
          <li key={tipo} className="flex flex-wrap items-center gap-3 py-3" data-testid={`som-${tipo}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(ROTULO[tipo].titulo)}</p>
              <p className="text-xs text-muted-foreground">{t(ROTULO[tipo].quando)}</p>
              <p className="text-xs text-muted-foreground" data-testid={`som-${tipo}-estado`}>
                {urls?.[tipo] ? t("Som personalizado") : t("Som do sistema")}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => ouvir(tipo)}>
              {t("Ouvir")}
            </Button>
            {podeTrocar ? (
              <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm">
                {enviando === tipo ? t("Enviando…") : t("Trocar som")}
                <input
                  type="file"
                  accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"
                  className="sr-only"
                  data-testid={`som-${tipo}-arquivo`}
                  disabled={enviando !== null}
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    e.target.value = "";
                    if (arquivo) void enviar(tipo, arquivo);
                  }}
                />
              </label>
            ) : null}
            {podeTrocar && urls?.[tipo] ? (
              <Button variant="ghost" size="sm" onClick={() => void remover(tipo)}>
                {t("Usar o do sistema")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
