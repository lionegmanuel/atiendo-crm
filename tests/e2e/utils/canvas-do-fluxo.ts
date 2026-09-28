import type { Page } from "@playwright/test";

/**
 * Reduz o zoom do canvas de follow-up até a escala ALVO, MEDINDO — nunca
 * contando cliques.
 *
 * As cinco specs do canvas clicavam N vezes em "reduzir zoom" para compensar o
 * salto a 200% que o enquadramento automático dava no primeiro nó de um fluxo
 * vazio (`FlowCanvas.tsx`, corrigido no mesmo PR que trouxe este arquivo).
 * Sem o salto, o mesmo número de cliques leva a escalas pequenas demais — os
 * cartões e as bolinhas de saída viram alvos de poucos pixels, e o arrasto
 * passa a errar. Medir a escala e parar no alvo vale antes e depois.
 *
 * É módulo compartilhado, e não a sexta cópia, porque a regra é a mesma nos
 * cinco arquivos e já cobrou o preço de divergir: três specs foram corrigidas
 * numa rodada e as duas que ficaram para trás reprovaram na seguinte.
 */
export async function zoomAte(page: Page, alvo: number): Promise<void> {
  const escala = async (): Promise<number> =>
    page.locator(".react-flow__viewport").evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return m.a || 1;
    });
  const zoomOut = page.locator(".react-flow__controls-zoomout");
  for (let i = 0; i < 10 && (await escala()) > alvo + 0.01; i++) {
    await zoomOut.click();
    await page.waitForTimeout(80);
  }
}
