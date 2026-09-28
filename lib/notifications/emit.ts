import { NOTIFY_KINDS, type NotifyKind } from "./kinds";
import { areAlertsEnabled, getPermission } from "./permission";
import { ensureNotifyServiceWorker } from "./service_worker";
import { playSound, type SoundId } from "./sounds";

const BODY_MAX = 140;

export interface EmitNotificationInput {
  kind: NotifyKind;
  title: string;
  body: string;
  tag?: string;
  href?: string;
  icon?: string;
  sound?: SoundId;
  force?: boolean;
}

export function truncateNotifyBody(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= BODY_MAX) return t;
  return `${t.slice(0, BODY_MAX - 1)}…`;
}

function absUrl(path: string): string {
  if (!path) return "";
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

/**
 * `new Notification()` é o que o Chrome desenha na bandeja; `silent: false`
 * usa o som do SO (AudioContext some com a aba oculta). Se o construtor falha,
 * cai no `showNotification` do service worker.
 */
export function emitNotification(input: EmitNotificationInput): void {
  if (typeof window === "undefined") return;
  const perm = getPermission();
  const enabled = areAlertsEnabled();
  if (!input.force && !enabled) return;
  if (perm !== "granted") return;

  const spec = NOTIFY_KINDS[input.kind];
  const sound = input.sound ?? spec.sound;
  const body = truncateNotifyBody(input.body);
  const tag = input.tag ? `${spec.tagPrefix}:${input.tag}` : `${spec.tagPrefix}:${Date.now()}`;
  const marca = absUrl("/icon");
  const icon = absUrl(input.icon || marca);
  const href = input.href ? absUrl(input.href) : "";
  const opts: NotificationOptions & { renotify?: boolean } = {
    body,
    tag,
    silent: false,
    renotify: true,
    icon,
    badge: marca,
    data: { href },
  };

  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    try {
      playSound(sound, 1.0);
    } catch {
      // AudioContext recusa
    }
  }

  try {
    const n = new Notification(input.title, opts);
    n.onclick = () => {
      window.focus();
      if (href) window.location.assign(href);
      n.close();
    };
  } catch {
    void showInOsTray(input.title, opts);
  }
}

async function showInOsTray(title: string, opts: NotificationOptions): Promise<void> {
  const reg = await ensureNotifyServiceWorker();
  const ready =
    typeof navigator !== "undefined" && navigator.serviceWorker
      ? await navigator.serviceWorker.ready.catch(() => null)
      : null;
  const alvo = ready ?? reg;
  if (!alvo) return;
  try {
    await alvo.showNotification(title, opts);
  } catch {
    // SW indisponível
  }
}
