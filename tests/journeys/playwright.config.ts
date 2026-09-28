import { defineConfig } from "@playwright/test";

/**
 * Config SEPARADA da suíte e2e (`playwright.config.ts` da raiz) de propósito:
 * a jornada de baseline dos canais é um instrumento de MEDIÇÃO, não um teste de
 * regressão. Se ela vivesse em `tests/e2e/`, o `npm run test:e2e` de cada task
 * mudaria de composição em relação ao baseline gravado na Task 0 — e o próprio
 * artefato de comparação viraria a variável que muda.
 *
 * Rodar: `pnpm run test:journeys` (ou `playwright test -c tests/journeys/playwright.config.ts`).
 * Pré-requisitos: app já buildada e servida na porta (não sobe servidor aqui —
 * o server é compartilhado com a coleta do trace de gates).
 */
const PORT = process.env.E2E_PORT ?? "3002";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  fullyParallel: false,
  /**
   * UM worker, não os 3 que o Playwright escolhe sozinho.
   *
   * `fullyParallel: false` serializa apenas DENTRO de cada arquivo; entre arquivos,
   * os workers continuam concorrendo. E estas jornadas compartilham tudo o que
   * importa: a MESMA organização, o MESMO contato, a MESMA sessão de canal. Enquanto
   * `canal-oficial` troca a credencial da sessão, `canais-baseline` está enviando
   * por ela.
   *
   * Medido em 4 corridas seguidas do mesmo código: 8/10, 10/10, 9/10, 8/10 — com
   * falha diferente a cada vez. Não é lentidão: é interferência.
   *
   * O custo é wall-clock; o benefício é um verde que significa alguma coisa. Suíte
   * que passa em metade das corridas não reprova mudança nenhuma.
   */
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Microfone falso: o composer grava áudio via getUserMedia/MediaRecorder —
    // sem isto o passo 5 da jornada não existe em headless.
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    permissions: ["microphone"],
  },
  projects: [
    // Loga UMA vez e guarda a sessão para as demais jornadas. O cabeçalho de
    // `auth.setup.ts` documenta o defeito que isto remove: com login por teste,
    // o PRIMEIRO teste de um arquivo caía, e qual arquivo mudava a cada corrida.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { browserName: "chromium", storageState: ".auth/journeys-admin.json" },
    },
  ],
});
