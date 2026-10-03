/**
 * `pnpm demo` — levanta, en UNA terminal, lo necesario para operar el CRM local
 * con WhatsApp vía Zernio:
 *
 *   app     `next start` (producción: sin overlay de dev ni HMR) en :3000
 *   worker  el agent-worker (`pnpm worker`): es quien hace que la IA responda
 *   túnel   `ngrok http --url=<dominio> 3000`, SOLO si CHANNEL_WEBHOOK_BASE_URL
 *           apunta a un dominio de ngrok y el binario existe (PATH, NGROK_BIN
 *           o `../ngrok.exe`). Si no, se asume que el túnel lo levantás aparte.
 *
 * Requiere `pnpm build` antes: sin build, avisa y sale en vez de caer en dev.
 * Ctrl+C cierra los tres.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const COLORES = { app: "\x1b[36m", worker: "\x1b[35m", tunel: "\x1b[33m" } as const;
const RESET = "\x1b[0m";
const hijos: ChildProcess[] = [];

function lanzar(nombre: keyof typeof COLORES, comando: string, critico = true): void {
  const hijo = spawn(comando, { shell: true, env: process.env });
  const prefijo = `${COLORES[nombre]}[${nombre}]${RESET} `;
  const volcar = (destino: NodeJS.WriteStream) => (chunk: Buffer) => {
    for (const linea of chunk.toString().split(/\r?\n/)) if (linea) destino.write(prefijo + linea + "\n");
  };
  hijo.stdout?.on("data", volcar(process.stdout));
  hijo.stderr?.on("data", volcar(process.stderr));
  hijo.on("exit", (code) => {
    process.stdout.write(`${prefijo}terminó (código ${code ?? "?"})\n`);
    if (critico) cerrar(code ?? 1);
  });
  hijos.push(hijo);
}

// Con `shell: true`, en Windows el hijo es el `cmd.exe` y `kill()` solo mata a
// ese: `next start`, el worker y `ngrok.exe` quedaban vivos, con el puerto 3000
// tomado y el túnel ocupado (ERR_NGROK_334) en el arranque siguiente. `taskkill
// /T` baja el árbol entero.
function terminar(h: ChildProcess): void {
  if (process.platform === "win32" && h.pid) {
    try {
      execSync(`taskkill /T /F /PID ${h.pid}`, { stdio: "ignore" });
      return;
    } catch {
      // El árbol ya no existe o taskkill no está disponible: cae al kill común.
    }
  }
  h.kill();
}

function cerrar(code: number): void {
  for (const h of hijos) if (h.exitCode === null) terminar(h);
  process.exit(code);
}

function binarioDeNgrok(): string {
  if (process.env.NGROK_BIN?.trim()) return `"${process.env.NGROK_BIN.trim()}"`;
  const vecino = resolve(process.cwd(), "..", "ngrok.exe");
  return existsSync(vecino) ? `"${vecino}"` : "ngrok";
}

function dominioDeNgrok(): string | null {
  const base = process.env.CHANNEL_WEBHOOK_BASE_URL?.trim();
  if (!base) return null;
  try {
    const host = new URL(base).host;
    return /\.ngrok(-free)?\.(app|dev|io)$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

if (!existsSync(resolve(process.cwd(), ".next", "BUILD_ID"))) {
  console.error("No hay build de producción. Corré primero: pnpm build");
  process.exit(1);
}

process.on("SIGINT", () => cerrar(0));
process.on("SIGTERM", () => cerrar(0));

lanzar("app", "pnpm start");
lanzar("worker", "pnpm worker");

const dominio = dominioDeNgrok();
if (dominio) {
  // No crítico: si ngrok falta o falla, el CRM sigue arriba y el error queda a la vista.
  lanzar("tunel", `${binarioDeNgrok()} http --url=${dominio} 3000 --log=stdout --log-level=warn`, false);
  console.info(`Webhook de Zernio: https://${dominio}/api/v1/webhooks/channel/<token>`);
} else {
  console.info(
    "Túnel no iniciado: poné tu dominio de ngrok en CHANNEL_WEBHOOK_BASE_URL (.env.local) o levantalo aparte.",
  );
}
console.info("CRM en http://localhost:3000 — Ctrl+C cierra todo.");
