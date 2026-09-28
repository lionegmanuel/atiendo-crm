"use client";

import { useT } from "@/hooks/i18n/useT";

import { cn } from "@/lib/utils";

import { AvatarDaPessoa } from "./AvatarDaPessoa";
import type { Pessoa } from "./tipos";

/**
 * Quem aparece na grade.
 *
 * Avatares empilhados, e clicar num deles ISOLA a agenda daquela pessoa —
 * pedido explícito do dono do produto. Não é multisseleção: numa equipe de
 * clínica a pergunta real é "o que a Ana tem hoje?", e uma caixinha por pessoa
 * transformaria isso em três cliques.
 *
 * O empilhamento com sobreposição (`-space-x-2`) é o que permite oito pessoas
 * caberem ao lado do título sem virar uma barra de rolagem horizontal — e o
 * anel na cor da superfície é o que mantém cada uma legível por cima da outra.
 */
export function FiltroDePessoas({
  pessoas,
  isolada,
  onIsolar,
  className,
}: {
  pessoas: Pessoa[];
  /** `null` = todos. */
  isolada: string | null;
  onIsolar: (id: string | null) => void;
  className?: string;
}) {
  const t = useT();
  // Um filtro com uma opção só não é um filtro — é um enfeite que ocupa espaço
  // e sugere uma escolha inexistente. O produto já faz isso no alternador do
  // inbox ("só aparece com 2+"), e a regra vale igual aqui.
  if (pessoas.length < 2) return null;

  return (
    <div
      data-testid="filtro-de-pessoas"
      data-isolada={isolada ?? "todos"}
      className={cn("flex items-center gap-2", className)}
    >
      <div className="flex -space-x-2">
        {pessoas.map((p) => {
          const ativo = isolada === null || isolada === p.id;
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`botao-pessoa-${p.id}`}
              aria-pressed={isolada === p.id}
              aria-label={
                isolada === p.id
                  ? `${t("Mostrar todos (agora só")} ${p.nome})`
                  : `${t("Ver só a agenda de")} ${p.nome}`
              }
              onClick={() => onIsolar(isolada === p.id ? null : p.id)}
              className={cn(
                "rounded-full transition-transform duration-fast ease-out",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
                // Sobe 2px em vez de crescer: escala mudaria a sobreposição e
                // faria os vizinhos parecerem se mexer junto.
                isolada === p.id ? "-translate-y-0.5" : "hover:-translate-y-0.5",
              )}
            >
              <AvatarDaPessoa pessoa={p} ativo={ativo} />
            </button>
          );
        })}
      </div>

      {isolada !== null && (
        <button
          type="button"
          data-testid="botao-todos"
          onClick={() => onIsolar(null)}
          className="rounded-sm px-2 py-1 text-xs text-text-muted transition-colors duration-fast hover:bg-surface-elevated hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          {t("Todos")}
        </button>
      )}
    </div>
  );
}
