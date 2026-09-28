"use client";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import { ImageIcon } from "@/lib/ui/icons";

/** Fallback compartilhado quando a mídia não carrega (expirada/removida). */
export function MediaUnavailable({ kind, className }: { kind: string; className?: string }) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg bg-background/40 text-muted-foreground",
        className || "h-24 w-56",
      )}
    >
      <ImageIcon size={20} weight="duotone" aria-hidden />
      <span className="text-xs">{t("Mídia indisponível")}</span>
      <span className="sr-only">{t(kind)}</span>
    </div>
  );
}
