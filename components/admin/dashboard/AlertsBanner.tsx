"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Warning } from "@/lib/ui/icons";
import { AlertItem } from "./AlertItem";
import type { AlertItem as AlertItemType } from "@/app/api/v1/admin/dashboard/kpis/route";
import { useT } from "@/hooks/i18n/useT";

interface AlertsBannerProps {
  alerts: AlertItemType[];
}

export function AlertsBanner({ alerts }: AlertsBannerProps) {
  const t = useT();
  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-5">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          <p className="text-sm text-muted-foreground">
            {t("Nenhum alerta crítico no momento. Tudo certo!")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const visible = alerts.slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Warning
            className={`h-4 w-4 ${hasCritical ? "text-red-500" : "text-amber-500"}`}
          />
          {t("Alertas ativos")}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {alerts.length} {alerts.length === 1 ? t("alerta") : t("alertas")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {visible.map((alert) => (
            <AlertItem key={alert.id} alert={alert} />
          ))}
        </div>
        {alerts.length > 10 && (
          <p className="px-3 py-2 text-xs text-muted-foreground border-t">
            +{alerts.length - 10} {t("alertas adicionais")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
