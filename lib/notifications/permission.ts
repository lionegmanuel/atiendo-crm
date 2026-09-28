export type NotificationPermissionState = NotificationPermission | "unsupported";

const ALERTS_ENABLED_KEY = "alerts.enabled";

/**
 * ASSINATURA DA PERMISSÃO — para `useSyncExternalStore`.
 *
 * Existe porque `Notification.permission` é um valor externo ao React que só o
 * CLIENTE conhece, e ler isso num `useEffect` cria uma janela: o primeiro render
 * usa um chute (`"default"`), o efeito corrige depois do paint, e entre os dois
 * a tela mostra um controle habilitado que vai desabilitar sozinho.
 *
 * `useSyncExternalStore` lê no próprio render e reconcilia logo após a
 * hidratação — sem o chute, e sem a janela. Ele exige um `subscribe`, e é o que
 * estas duas funções são: a permissão não emite evento próprio confiável em
 * todos os navegadores, então quem a muda (`requestPermission`) avisa.
 */
type OuvinteDePermissao = () => void;
const ouvintes = new Set<OuvinteDePermissao>();

export function assinarPermissao(ouvinte: OuvinteDePermissao): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function avisarMudancaDePermissao(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function getPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  const resultado = await Notification.requestPermission();
  avisarMudancaDePermissao();
  return resultado;
}

export function areAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(ALERTS_ENABLED_KEY);
    if (raw === "0") return false;
    if (raw === "1") return getPermission() === "granted";
  } catch {
    // localStorage bloqueado — trata como desligado
  }
  return getPermission() === "granted";
}

export function setAlertsEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERTS_ENABLED_KEY, on ? "1" : "0");
  } catch {
    // ignore
  }
}
