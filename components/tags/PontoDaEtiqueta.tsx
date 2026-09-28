"use client";
/**
 * O ponto de cor do filtro (issue #1271, fatia S6 da #852).
 *
 * ─── Por que ponto, e não chip, na opção do filtro ──────────────────────────
 *
 * As três listas de filtro são colunas estreitas: no Inbox o seletor divide uma
 * linha de 280 px com o filtro de número; no funil e em Contatos é um item de
 * menu. O chip inteiro pintado ali empurraria o texto e quebraria o rótulo — o
 * ponto dá a mesma informação (a cor da etiqueta) em 8 px.
 *
 * O NOME continua sendo o que a pessoa lê. A cor acelera o reconhecimento de
 * quem já conhece o vocabulário da operação; ninguém precisa decorar cor nenhuma
 * para usar o filtro.
 *
 * Sem cor não desenha nada: um ponto cinza ao lado de cada etiqueta sem cor
 * transformaria "não escolhi" em "escolhi cinza", e a tela ficaria mais poluída
 * do que estava antes desta fatia.
 */
import { cn } from "@/lib/utils";
import { useCorDaEtiqueta } from "@/components/tags/CoresDasEtiquetas";

export function PontoDaEtiqueta({ tag, className }: { tag: string; className?: string }) {
  const cor = useCorDaEtiqueta(tag);
  if (cor === null) return null;
  return (
    <span
      data-ponto-da-etiqueta={tag}
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: cor }}
    />
  );
}
