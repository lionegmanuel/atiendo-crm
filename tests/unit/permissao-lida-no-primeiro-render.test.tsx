import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O INTERRUPTOR DE PUSH NÃO NASCE HABILITADO PARA DEPOIS SE DESABILITAR.
 *
 * ## O defeito
 *
 * `useNotificationPermission` fazia `useState("default")` + `useEffect(() =>
 * setPermission(getPermission()))`. O `"default"` é um CHUTE — uma das três
 * respostas possíveis, escolhida antes de olhar. Como `_client.tsx` desabilita
 * o Push por `denied || unsupported`, a sequência era:
 *
 *   1. primeiro render → `"default"` → interruptor HABILITADO;
 *   2. efeito roda DEPOIS do paint, lê `denied` → ele desabilita sozinho.
 *
 * Quem tem a notificação bloqueada via, por um instante, um controle pronto
 * para uso que sumia na frente dele.
 *
 * ## Por que `renderToStaticMarkup`, e não Testing Library
 *
 * É a escolha do instrumento, e ela é o teste inteiro. `render()` da Testing
 * Library roda os efeitos dentro de `act()` — com ele, o código ANTIGO e o NOVO
 * produzem o MESMO resultado final, e o teste ficaria verde sobre o defeito.
 *
 * `renderToStaticMarkup` **não roda efeitos**. É exatamente a fatia de tempo
 * onde o defeito vive: o que a pessoa vê antes de o efeito chegar. Um valor
 * correto aqui só é possível se a leitura acontecer no RENDER.
 *
 * ## O que isto NÃO cobre, declarado
 *
 * Não mede o que o usuário vê no navegador — mede a árvore que o React produz
 * sem efeitos. `tests/e2e/notificacoes-diz-o-que-falta.spec.ts` continua sendo
 * quem exercita a tela, e ele concede a permissão de propósito para isolar a
 * variável VAPID.
 */

const original = Reflect.getOwnPropertyDescriptor(globalThis, "Notification");

function comPermissaoDoNavegador(valor: string): void {
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: { permission: valor, requestPermission: vi.fn() },
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "Notification", original);
  else Reflect.deleteProperty(globalThis, "Notification");
  vi.resetModules();
});

async function markupSemEfeitos(): Promise<string> {
  vi.resetModules();
  const { NotificationPrefsClient } = await import(
    "@/app/app/settings/notifications/_client"
  );
  return renderToStaticMarkup(<NotificationPrefsClient />);
}

/**
 * Os `<button role="switch">` de Push, e se cada um traz o ATRIBUTO `disabled`.
 *
 * ⚠️ `includes("disabled")` NÃO serve aqui, e isto não é preciosismo: a classe
 * do `<Switch>` carrega `disabled:cursor-not-allowed disabled:opacity-50`, que
 * são utilitários do Tailwind e existem em TODO botão, habilitado ou não. A
 * primeira versão desta função usava `includes` e por isso respondia "sim" para
 * os dois estados — os casos abaixo ficaram verdes medindo a folha de estilo.
 *
 * O atributo real vem como `disabled=""` no markup. O `[=\s>]` no fim é o que
 * separa o atributo do prefixo `disabled:` das classes.
 */
function pushDesabilitado(markup: string): boolean[] {
  return [...markup.matchAll(/<button[^>]*aria-label="[^"]*via push"[^>]*>/g)].map((m) =>
    /\sdisabled[=\s>]/.test(m[0]),
  );
}

describe("a permissão do navegador é lida no primeiro render", () => {
  it("o instrumento está vivo — controle positivo antes de qualquer conclusão", async () => {
    comPermissaoDoNavegador("denied");
    const markup = await markupSemEfeitos();
    // Se o seletor parar de casar, todo caso abaixo vira `[] === []` e passa
    // verde medindo nada.
    expect(
      pushDesabilitado(markup).length,
      "não achei nenhum interruptor 'via push' no markup — o seletor morreu",
    ).toBeGreaterThan(0);
  });

  it("⭐ com a notificação BLOQUEADA no navegador, ele já nasce desabilitado", async () => {
    comPermissaoDoNavegador("denied");
    const markup = await markupSemEfeitos();
    expect(
      pushDesabilitado(markup).every(Boolean),
      "o interruptor nasce habilitado e só desabilita depois do efeito — " +
        "é a janela em que a tela oferece o que já está negado",
    ).toBe(true);
  });

  it("⭐ com a notificação CONCEDIDA, ele já nasce habilitado", async () => {
    comPermissaoDoNavegador("granted");
    const markup = await markupSemEfeitos();
    // O outro sentido: um conserto que simplesmente desabilitasse sempre
    // passaria no caso acima e falharia aqui. Guarda de um lado só vira defeito
    // do outro — e foi exatamente assim que o detector quebrado desta suíte
    // apareceu: os dois primeiros casos estavam verdes medindo a folha de
    // estilo, e só este reprovou.
    expect(
      pushDesabilitado(markup).some(Boolean),
      "a permissão está concedida e o interruptor nasce desabilitado",
    ).toBe(false);
  });

  it("⭐ VAPID ausente NÃO desabilita o Push — o conserto exagerado, barrado", async () => {
    /**
     * Esta asserção morava em `tests/e2e/notificacoes-diz-o-que-falta.spec.ts`
     * e não podia viver lá. MEDIDO no Chromium do Playwright:
     *
     *     baseline headless                             -> denied
     *     grantPermissions(["notifications"]) sem origin -> denied
     *     grant com origin explícito                     -> denied
     *     headless:false + grant                         -> granted
     *
     * `Notification.permission` é **denied em headless, sempre**, e o CI roda
     * headless — então lá o controle está travado por `denied`, um motivo que
     * nada tem a ver com VAPID. A spec passava só enquanto ganhava a corrida
     * contra a hidratação.
     *
     * Aqui a variável fica isolada: NENHUM `VAPID_*` está definido neste
     * processo (é `vitest`, não o servidor Next), a permissão está `granted`, e
     * o controle tem de nascer habilitado. Se alguém "consertar" o defeito de
     * promessa desabilitando o Push por falta de chaves, este caso reprova.
     *
     * Por que isso importa: sem VAPID o aviso na bandeja AINDA funciona com a
     * aba aberta — é `new Notification()` em `lib/notifications/emit.ts`, que
     * não depende de inscrição. Desabilitar trocaria prometer demais por
     * entregar de menos, e o segundo não deixa rastro.
     */
    expect(
      process.env.VAPID_PUBLIC_KEY ?? "",
      "controle: este caso só significa algo sem VAPID no ambiente",
    ).toBe("");

    comPermissaoDoNavegador("granted");
    const markup = await markupSemEfeitos();
    expect(
      pushDesabilitado(markup).some(Boolean),
      "sem VAPID o Push nasceu desabilitado — é o conserto exagerado, que tira " +
        "o aviso com a aba aberta junto",
    ).toBe(false);
  });
});
