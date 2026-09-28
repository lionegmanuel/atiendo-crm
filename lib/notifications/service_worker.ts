/** Registra o SW de bandeja + Web Push. */
export async function ensureNotifyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    return await navigator.serviceWorker.register("/notify-sw.js", { scope: "/" });
  } catch {
    return null;
  }
}
