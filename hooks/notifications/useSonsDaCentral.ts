"use client";
/**
 * Toca o som da organização quando um aviso NOVO entra na Central: a etapa
 * que avisa e o pedido de pessoa (ver `lib/notifications/sons-da-org.ts`).
 *
 * Roda na campainha do topo, que já lê a Central — nenhuma consulta a mais além
 * das URLs dos sons, renovadas antes de a assinatura (1 h) vencer.
 *
 * O navegador só deixa tocar áudio depois de a pessoa interagir com a página;
 * se recusar, cai no bipe do produto, e se nem isso, o aviso segue visível.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AgentInboxItem } from "@/hooks/ai/useAgentInbox";
import { apiClient } from "@/lib/api/client";
import { playSound } from "@/lib/notifications/sounds";
import { SOM_PADRAO, sonsNovos, type TipoDeSom } from "@/lib/notifications/sons-da-org";

type UrlsDosSons = Record<TipoDeSom, string | null>;

function tocar(tipo: TipoDeSom, url: string | null): void {
  if (!url) {
    playSound(SOM_PADRAO[tipo]);
    return;
  }
  try {
    const audio = new Audio(url);
    void audio.play().catch(() => playSound(SOM_PADRAO[tipo]));
  } catch {
    playSound(SOM_PADRAO[tipo]);
  }
}

export function useSonsDaCentral(avisos: ReadonlyArray<AgentInboxItem> | undefined): void {
  const vistos = useRef<Set<string> | null>(null);
  const { data: urls } = useQuery({
    queryKey: ["settings-sons"],
    queryFn: () => apiClient.get<{ data: UrlsDosSons }>("/api/v1/settings/sons").then((r) => r.data),
    staleTime: 45 * 60_000,
    refetchInterval: 45 * 60_000,
  });
  const urlsRef = useRef<UrlsDosSons | undefined>(urls);
  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);

  useEffect(() => {
    if (!avisos) return;
    const tipos = sonsNovos(vistos.current, avisos);
    vistos.current = new Set([...(vistos.current ?? []), ...avisos.map((a) => a.id)]);
    for (const tipo of tipos) tocar(tipo, urlsRef.current?.[tipo] ?? null);
  }, [avisos]);
}
