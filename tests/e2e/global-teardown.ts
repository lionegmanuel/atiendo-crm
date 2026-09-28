import { limparSessoesDeCanalE2E } from "../../scripts/cleanup-e2e-channel-sessions";

export default async function globalTeardown(): Promise<void> {
  const { removidas } = await limparSessoesDeCanalE2E();
  if (removidas > 0) {
    console.info(`[e2e teardown] sessões de canal removidas: ${removidas}`);
  }
}
