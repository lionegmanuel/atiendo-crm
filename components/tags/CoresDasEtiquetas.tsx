"use client";
/**
 * As cores das etiquetas da organização ativa, UMA leitura por tela
 * (issue #1271, fatia S6 da #852).
 *
 * ─── Por que um provider, e não um hook por chip ────────────────────────────
 *
 * O chip aparece em lista: uma fila de 200 conversas desenha 400 chips. Se cada
 * um tivesse o próprio `useQuery`, seriam 400 assinaturas do mesmo cache — e o
 * pior custo não é a rede (o react-query deduplica), é o RE-RENDER: qualquer
 * atualização do cache acordaria todas.
 *
 * ─── Por que o contexto tem valor padrão, e não `throw` ─────────────────────
 *
 * Fora do provider — teste unitário de um componente isolado, tela de admin que
 * não é do produto — o mapa fica vazio e o chip sai CINZA, que é o estado
 * anterior a esta fatia. Um `throw` como o do `useAuth` aqui seria pior do que
 * inútil: derrubaria a tela inteira por causa de uma cor. Degradar para o cinza
 * é a mesma escolha do dicionário de idioma (falta de tradução cai no português,
 * nunca na chave crua).
 *
 * ─── O que a falha da leitura NÃO faz ───────────────────────────────────────
 *
 * Não vira erro visível: `data` fica `undefined`, o mapa fica vazio e a tela
 * mostra o que mostrava antes. Cor é reforço; sem ela a etiqueta continua
 * legível pelo nome. É o inverso do `useContactTagVocabulary`, onde a falha
 * esconde o bloco de sugestões — lá a informação É a lista.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { apiClient } from "@/lib/api/client";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { chaveDaEtiqueta, coresDoVocabulario, type CoresPorEtiqueta } from "@/lib/tags/cor-da-etiqueta";

/**
 * A chave do cache, exportada para quem ESCREVE poder invalidar: a tela de Tags
 * salva a cor e precisa que os chips da mesma página repintem sem F5. `staleTime`
 * de 5 min é o mesmo do vocabulário de sugestões — a cor muda quando um gerente
 * decide, não a cada conversa.
 */
export const CHAVE_DAS_CORES = "cores-das-etiquetas";

export function invalidarCoresDasEtiquetas(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [CHAVE_DAS_CORES] });
}

const VAZIO: CoresPorEtiqueta = {};

const Ctx = createContext<CoresPorEtiqueta>(VAZIO);

export function ProvedorDeCoresDasEtiquetas({ children }: { children: ReactNode }) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;
  const { data } = useQuery({
    queryKey: [CHAVE_DAS_CORES, orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CoresPorEtiqueta> => {
      // A rota devolve a lista crua do vocabulário (`{tag, cor}`); o mapa é
      // montado AQUI pela mesma função pura que a rota usa para filtrar, para
      // não existirem duas interpretações de "etiqueta com cor".
      const res = await apiClient.get<{ data: { tag: string; cor: string }[] }>(
        "/api/v1/tags/cores",
      );
      return coresDoVocabulario({ tags: res.data });
    },
  });
  const valor = useMemo(() => data ?? VAZIO, [data]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** O mapa inteiro — para quem desenha uma lista de opções (filtros). */
export function useCoresDasEtiquetas(): CoresPorEtiqueta {
  return useContext(Ctx);
}

/** A cor de UMA etiqueta, ou `null`. */
export function useCorDaEtiqueta(tag: string | null | undefined): string | null {
  const mapa = useCoresDasEtiquetas();
  if (!tag) return null;
  return mapa[chaveDaEtiqueta(tag)] ?? null;
}
