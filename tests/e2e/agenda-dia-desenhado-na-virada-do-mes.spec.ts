/**
 * GUARDA de `escolherDiaDesenhado` na virada do mês — sem servidor, sem banco.
 *
 * `cliente-pela-agenda` e `agenda-google-meet` reprovaram no run 36292363538
 * (27/09/2026 ~04h UTC) com "nenhum dia da semana desenhada (2026-10-04 …
 * 2026-10-10) está disponível no painel". O trace mostrou a causa: depois do
 * clique em `mes-seguinte` o painel pinta outubro com os horários de SETEMBRO
 * por baixo, e a janela de setembro traz o dia 1º. A espera antiga ("algum dia
 * disponível") passava nesse quadro e a varredura lia só o dia 1º.
 *
 * Esta página imita exatamente os dois estados do produto (`mes` do painel,
 * que troca no clique; `mesDoPainel` do `_client`, que troca depois e dispara a
 * consulta), com o relógio fixo no instante da falha. Com a espera antiga o
 * caso reprova com a mesma mensagem do CI; esperando um dia da SEMANA DESENHADA
 * acender, escolhe um deles.
 */
import { test, expect } from "./helpers/test";

import { escolherDiaDesenhado } from "./helpers/agenda-semana-integra";

test.use({ timezoneId: "UTC" });

const ORIGEM = "http://agenda-falsa.test";
const AGORA = new Date("2026-09-27T04:20:00Z");
const SEMANA_DESENHADA = [
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
];

// O painel reduzido ao que o helper lê. `janela(mes)` repete a conta de
// `janelaDoMesVisivel`: do 1º (ou de agora) até `endOfMonth + 1 dia`.
const PAGINA = `<!doctype html><html><body><div id="painel"></div>
<button data-testid="mes-seguinte">›</button>
<script>
  const chave = (d) => d.toISOString().slice(0, 10);
  const agora = new Date();
  let mes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  let horarios = {};
  const pedir = async (m) => {
    horarios = null; pintar();
    const fim = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 23, 59));
    const de = m < agora ? agora : m;
    const r = await fetch("/api/v1/agenda/horarios-livres?de=" + de.toISOString() + "&ate=" + fim.toISOString());
    horarios = await r.json(); pintar();
  };
  function pintar() {
    const primeiro = new Date(mes); primeiro.setUTCDate(1 - mes.getUTCDay());
    let html = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(primeiro); d.setUTCDate(primeiro.getUTCDate() + i);
      const doMes = d.getUTCMonth() === mes.getUTCMonth();
      const livre = doMes && !!horarios && !!horarios[chave(d)];
      html += '<button data-testid="dia-' + chave(d) + '" data-disponivel="' + livre + '">' + d.getUTCDate() + "</button>";
    }
    document.getElementById("painel").innerHTML = html;
  }
  document.querySelector('[data-testid="mes-seguinte"]').onclick = () => {
    mes = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1));
    pintar(); // o painel já está no mês novo; os horários ainda são do velho
    setTimeout(() => pedir(mes), 300); // o efeito onMesVisivel troca a chave depois
  };
  pedir(mes);
</script></body></html>`;

test("depois de 'mês seguinte', o dia escolhido é da semana desenhada, não do quadro de transição", async ({
  page,
}) => {
  await page.clock.setFixedTime(AGORA);
  await page.route(`${ORIGEM}/api/v1/agenda/horarios-livres*`, async (rota) => {
    const u = new URL(rota.request().url());
    const de = new Date(u.searchParams.get("de")!);
    const ate = new Date(u.searchParams.get("ate")!);
    const livres: Record<string, true> = {};
    for (let d = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate() + 1)); d < ate; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) livres[d.toISOString().slice(0, 10)] = true;
    }
    await new Promise((r) => setTimeout(r, 400));
    await rota.fulfill({ json: livres });
  });
  await page.route(`${ORIGEM}/`, (rota) => rota.fulfill({ contentType: "text/html", body: PAGINA }));
  await page.goto(`${ORIGEM}/`);

  // Pré-condição do defeito: setembro em tela, com o dia 1º de outubro na janela.
  await expect(page.getByTestId("dia-2026-09-28")).toHaveAttribute("data-disponivel", "true");

  expect(await escolherDiaDesenhado(page, SEMANA_DESENHADA)).toBe("2026-10-05");
});
