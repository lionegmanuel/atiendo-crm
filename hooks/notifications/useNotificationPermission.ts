"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { emitNotification } from "@/lib/notifications/emit";
import {
  areAlertsEnabled,
  assinarPermissao,
  getPermission,
  requestPermission,
  setAlertsEnabled,
  type NotificationPermissionState,
} from "@/lib/notifications/permission";
import { syncPushSubscription } from "@/lib/notifications/push_client";
import { ensureNotifyServiceWorker } from "@/lib/notifications/service_worker";
import { resumeAudio } from "@/lib/notifications/sounds";

function confirmOnOs(on: boolean): void {
  emitNotification({
    kind: "alerts_toggle",
    title: on ? "Alertas ligados" : "Alertas desligados",
    body: on
      ? "Novas mensagens aparecem na bandeja do sistema."
      : "Este navegador não vai mais avisar na bandeja.",
    force: true,
    sound: on ? "success" : "failure",
  });
}

export function useNotificationPermission(): {
  permission: NotificationPermissionState;
  enabled: boolean;
  request: () => Promise<NotificationPermissionState>;
  setEnabled: (on: boolean) => void;
} {
  /**
   * ⚠️ LIDA NO RENDER, NÃO NUM EFEITO — e isso conserta uma tela, não um teste.
   *
   * Isto era `useState("default")` + `useEffect(() => setPermission(...))`, e o
   * `"default"` é um CHUTE: ele significa "o navegador ainda não perguntou",
   * que é uma das três respostas possíveis, escolhida antes de olhar. Como
   * `denied` desabilita o interruptor de Push em `_client.tsx`, a sequência era:
   *
   *   1. primeiro render → `"default"` → interruptor HABILITADO;
   *   2. o efeito roda DEPOIS do paint, lê `denied`, e ele desabilita sozinho.
   *
   * Quem tem a notificação bloqueada no navegador via, por um instante, um
   * controle pronto para uso que sumia na frente dele — e um clique naquela
   * janela ia parar num `request()` que já estava decidido.
   *
   * `useSyncExternalStore` lê o valor no PRÓPRIO render e reconcilia junto com
   * a hidratação, sem chute e sem janela. No servidor `getPermission()` devolve
   * `"unsupported"` sozinho (não existe `Notification` lá), o que é a verdade
   * daquele ambiente e desabilita o controle no HTML — o único flash que sobra
   * é o seguro, de desabilitado para habilitado, que nunca oferece o que talvez
   * não funcione.
   *
   * O custo dessa janela não foi teórico: ela deixou
   * `tests/e2e/notificacoes-diz-o-que-falta.spec.ts` passando por SORTE, e o
   * primeiro PR a mudar o timing o bastante para perder a corrida ficou vermelho
   * sem ter quebrado nada.
   */
  const permission = useSyncExternalStore(assinarPermissao, getPermission, getPermission);
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    setEnabledState(areAlertsEnabled());
  }, []);

  const request = useCallback(async () => {
    await resumeAudio();
    const next = await requestPermission();
    if (next === "granted") {
      setAlertsEnabled(true);
      setEnabledState(true);
      void ensureNotifyServiceWorker().then(() => syncPushSubscription());
      confirmOnOs(true);
    }
    return next;
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setAlertsEnabled(on);
    setEnabledState(on);
    if (on) {
      void resumeAudio();
      void ensureNotifyServiceWorker().then(() => syncPushSubscription());
    }
    confirmOnOs(on);
  }, []);

  return { permission, enabled, request, setEnabled };
}
