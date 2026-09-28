/**
 * Um login por corrida, não um por teste.
 *
 * ─── O defeito que isto remove ──────────────────────────────────────────────
 * Cada jornada logava do zero: nove logins com MFA em dois minutos. Rodando
 * isoladas, todas passavam; rodando em série, o **primeiro teste de um arquivo**
 * caía — e qual arquivo mudava a cada corrida. A foto da falha mostrava a tela de
 * `/login` com os campos vazios: tínhamos chegado em `/login/mfa` e voltado.
 *
 * Tentei primeiro a hipótese barata (replay do código TOTP, que é de uso único) e
 * ela foi **descartada por medição**: com o guard de replay no lugar, a falha
 * continuou, só trocou de arquivo. A causa exata do lado do GoTrue não foi
 * isolada — o container tinha sido reiniciado e não guardava log do período.
 *
 * O que se sabe com certeza é o suficiente para decidir: a falha vem de logins
 * consecutivos, e nenhuma jornada além de uma precisa exercitar o login. Logar uma
 * vez remove a classe inteira em vez de calibrar o timeout até parar de doer — e
 * corta ~2min de corrida por tabela.
 *
 * `canais-baseline` continua fazendo o login REAL pela tela, porque ali o login é
 * o objeto do teste. Ele declara `storageState` vazio para começar deslogado.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test as setup } from "@playwright/test";

import { loginAdmin } from "./_login";

export const ESTADO_ADMIN = path.join(process.cwd(), ".auth", "journeys-admin.json");

setup("autentica o admin uma vez para as jornadas", async ({ page }) => {
  fs.mkdirSync(path.dirname(ESTADO_ADMIN), { recursive: true });
  await loginAdmin(page);
  await page.context().storageState({ path: ESTADO_ADMIN });
});
