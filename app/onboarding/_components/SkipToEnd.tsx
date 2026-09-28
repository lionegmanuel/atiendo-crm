"use client";

import { startTransition } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { finishOnboarding } from "@/app/actions/onboarding/finishOnboarding";

export function SkipToEnd() {
  const t = useT();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-xs text-muted-foreground"
      onClick={() => {
        startTransition(() => {
          void finishOnboarding();
        });
      }}
    >
      {t("Pular tudo (DEV)")}
    </Button>
  );
}
