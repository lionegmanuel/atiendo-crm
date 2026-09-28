"use client";

import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowsClockwise, WarningOctagon } from "@/lib/ui/icons";

import { JANELA_DA_GRADE } from "./GradeDaAgenda";

/**
 * Carregando com a FORMA da grade, não três barras genéricas.
 *
 * É o que o resto do produto faz (`app/app/kanban/loading.tsx` desenha 5 colunas
 * × 3 cards) e a razão é de percepção: um esqueleto com a silhueta certa faz a
 * espera parecer continuação, enquanto um retângulo genérico faz parecer que a
 * página trocou. As mesmas 7 colunas e a mesma janela de horas da grade real.
 */
export function AgendaCarregando() {
  const t = useT();
  // `bg-neutral-400` em cada Skeleton, e não o default do primitivo.
  //
  // `components/ui/skeleton.tsx` usa `bg-primary/10` — a accent a 10% —, que dá
  // contraste 1.146:1 sobre o branco: o esqueleto some, e a espera vira uma
  // grade vazia em vez de promessa de conteúdo. Visto no screenshot, não no
  // código.
  //
  // O primeiro conserto foi `bg-border`, e o maestro mediu que era insuficiente:
  // 1.281:1, doze por cento melhor e ainda invisível. Ele também levantou o que
  // ninguém tinha medido — o esqueleto PULSA (`animate-pulse` oscila a opacidade
  // entre 1 e .5 a cada 2s), então ele vive entre DOIS contrastes e o olho lê o
  // movimento entre eles. Medido, sobre superfície branca:
  //
  //     candidato          cheio    apagado   delta L*
  //     bg-primary/10      1.146     1.067      2.81
  //     bg-border          1.281     1.129      4.85
  //     border-strong      1.588     1.249      8.82
  //     neutral-400        2.512     1.525     16.77   <- escolhido
  //
  // `neutral-400` foi escolhido por ser quase SIMÉTRICO entre os temas (2.512 no
  // claro, 2.622 no escuro): um esqueleto que aparece num tema e some no outro é
  // o mesmo defeito resolvido pela metade. Fica abaixo do piso WCAG de 3:1 para
  // gráfico não-textual — aceitável porque o esqueleto não carrega informação
  // que se lê, e o pulso de 16.77 em L* o torna inequívoco.
  //
  // Não mexo no primitivo: 113 usos em 51 arquivos da main. A correção lá é item
  // de produto, escalado pelo QAVivo, não drive-by no PR do calendário.
  const linhas = JANELA_DA_GRADE.ultima - JANELA_DA_GRADE.primeira + 1;
  return (
    <div
      data-testid="agenda-carregando"
      aria-busy="true"
      aria-label={t("Carregando a agenda")}
      className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="w-12 shrink-0 border-r border-border">
        <div className="h-8 border-b border-border" />
        {Array.from({ length: linhas }).map((_, i) => (
          <div key={i} className="flex h-12 items-start justify-end border-b border-border/50 p-1">
            <Skeleton className="h-2.5 w-6 bg-neutral-400" />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1">
        {Array.from({ length: 7 }).map((_, col) => (
          <div key={col} className="min-w-0 flex-1 border-r border-border last:border-r-0">
            <div className="flex h-8 items-center justify-center border-b border-border">
              <Skeleton className="h-3 w-10 bg-neutral-400" />
            </div>
            <div className="space-y-2 p-1.5">
              {/* Alturas diferentes por coluna: um esqueleto perfeitamente
                  regular parece uma tabela, não uma agenda. */}
              <Skeleton className="h-10 w-full bg-neutral-400" style={{ marginTop: (col % 3) * 28 }} />
              {col % 2 === 0 && <Skeleton className="h-16 w-full bg-neutral-400" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Erro que nomeia o dono do problema.
 *
 * Guardar a mensagem e jogar fora a origem é o defeito que esta base já
 * registrou: quem lê "não foi possível carregar" não sabe se tenta de novo, se
 * reconecta a agenda do Google, ou se abre um chamado.
 */
export function AgendaComErro({
  motivo,
  onTentarDeNovo,
}: {
  motivo: string;
  onTentarDeNovo?: () => void;
}) {
  const t = useT();
  return (
    <div
      data-testid="agenda-com-erro"
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-error/30 bg-error-bg p-8 text-center"
    >
      <WarningOctagon size={28} weight="duotone" className="text-error" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-text">{t("Não consegui carregar a agenda")}</p>
        <p className="mt-1 max-w-sm text-xs text-text-muted">{t(motivo)}</p>
      </div>
      {onTentarDeNovo && (
        <Button variant="outline" size="sm" onClick={onTentarDeNovo} data-testid="tentar-de-novo">
          <ArrowsClockwise size={16} weight="bold" aria-hidden />
          <span>{t("Tentar de novo")}</span>
        </Button>
      )}
    </div>
  );
}
