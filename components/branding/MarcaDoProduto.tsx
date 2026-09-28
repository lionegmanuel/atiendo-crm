import { cn } from "@/lib/utils";

/**
 * A marca DINÂMICA — o que a tela mostra quando ninguém configurou logo
 * (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Isotipo minimalista (ladrilho esmeralda com a inicial) + o `nome` em vigor
 * renderizado como texto. Nada é soletrado em vetor: trocar `APP_NAME` no
 * `.env` troca o logotipo inteiro, sem tocar código.
 *
 * Inline, e não `<img src="/algo.svg">`: a barra lateral já usa `<img>` para o
 * logo CONFIGURADO, e o e2e `marca-logo.spec.ts` mede "barra sem `<img>`" como
 * "sem logo do revendedor".
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

/** Acento esmeralda do isotipo. */
export const COR_DO_ISOTIPO = "#10b981";

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/** Spread e não `[0]`: nome começando com emoji ou acento composto quebraria no meio do code point. */
function inicial(nome: string): string {
  return ([...nome.trim()][0] ?? "").toUpperCase();
}

function Isotipo({
  nome,
  className,
  ...aria
}: { nome: string; className?: string } & React.AriaAttributes & { role?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} {...aria}>
      <rect width="32" height="32" rx="8" fill={COR_DO_ISOTIPO} />
      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="18"
        fontWeight="700"
        fill="#ffffff"
        style={{ fontFamily: "inherit" }}
      >
        {inicial(nome)}
      </text>
    </svg>
  );
}

/** O isotipo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return <Isotipo nome={nome} className={className} {...acessibilidade(nome, decorativo)} />;
}

/** Isotipo + nome — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-2", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <Isotipo nome={nome} className="h-full w-auto" aria-hidden />
      <span aria-hidden className="whitespace-nowrap font-semibold leading-none tracking-tight text-foreground">
        {nome}
      </span>
    </span>
  );
}
