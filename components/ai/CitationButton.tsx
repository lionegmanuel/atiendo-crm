"use client";
import { useState } from "react";
import { Info } from "@/lib/ui/icons";
import { CitationsPanel } from "./CitationsPanel";
import type { Citation } from "@/lib/ai/citations/types";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  citations: Citation[];
  messageId?: string;
  className?: string;
}

export function CitationButton({ citations, messageId, className }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Mostrar citações da resposta")}
        className={
          "inline-flex items-center justify-center rounded-full p-1 opacity-70 transition hover:opacity-100 " +
          (className ?? "")
        }
      >
        <Info size={12} weight="duotone" aria-hidden />
      </button>
      <CitationsPanel
        open={open}
        onOpenChange={setOpen}
        citations={citations}
        messageId={messageId}
      />
    </>
  );
}
