"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import { format } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { ClockCountdown } from "@/lib/ui/icons";
import type { AuditTrailEntry } from "@/hooks/useLgpdRequest";

interface AuditTrailProps {
  entries: AuditTrailEntry[];
}

export function AuditTrail({ entries }: AuditTrailProps) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Nenhuma entrada de auditoria registrada para esta solicitação.")}
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, idx) => {
        const isLast = idx === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="mt-1 h-2 w-2 rounded-full bg-border ring-2 ring-background" aria-hidden />
              {!isLast && <div className="mt-1 h-full min-h-[24px] w-px bg-border" aria-hidden />}
            </div>
            <div className={`pb-3 min-w-0 flex-1 ${isLast ? "pb-0" : ""}`}>
              <p className="text-sm font-mono font-medium truncate">{entry.action}</p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(entry.created_at), "dd/MM/yyyy HH:mm:ss", { locale: localeDaData })}
                {entry.actor_user_id && (
                  <span className="ml-2 opacity-60">
                    {t("por")} {entry.actor_user_id.slice(0, 8)}…
                  </span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AuditTrailSkeleton() {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <ClockCountdown size={16} aria-hidden />
      {t("Carregando auditoria…")}
    </div>
  );
}
