/**
 * O SINAL DE PRESENÇA DO ATENDENTE — a peça que faltava desde o AT-08.
 *
 * ─── O defeito, por leitura (main@cf35c94, v1.28.0) ────────────────────────
 *
 * O produto tinha o LEITOR do sinal e nunca teve o EMISSOR:
 * `app/api/v1/cron/attendant-heartbeat/route.ts` marcava `is_available=false`
 * em quem não emitisse sinal de vida há 15 min, e nenhum arquivo do repositório
 * emitia sinal nenhum. O único escritor de `last_heartbeat_at` era o clique no
 * botão de plantão — um carimbo de clique se fingindo de batida. Resultado
 * medido pelo @paulolimajr77 no PR #720: a chave de plantão se desligava
 * sozinha ~15 min depois de ligada, em toda instalação.
 *
 * O PR #720 tirou o cron e passou a DERIVAR o plantão da jornada
 * (`estaDePlantao`), o que resolve o desligamento — mas deixou a informação
 * "tem alguém aí?" sem existir em lugar nenhum. É esta peça.
 *
 * ─── A fronteira: duas coisas, duas colunas ───────────────────────────────
 *
 *   | pergunta                        | onde mora                      | dura? |
 *   |---------------------------------|--------------------------------|-------|
 *   | "eu me declarei de plantão"     | `is_available` — DECISÃO       | dura  |
 *   | "meu navegador está aberto"     | `last_heartbeat_at` — PRESENÇA | expira|
 *
 * A presença NÃO escreve na decisão, nunca. Quem derruba alguém do plantão é a
 * pessoa (a chave) ou a jornada publicada — jamais o navegador fechando. Este
 * módulo não tem sequer como tocar em `is_available`: o predicado do plantão
 * (`estaDePlantao`, em `lib/routing/eligibility.ts`) não recebe presença como
 * entrada. A separação é de tipo, não de disciplina.
 *
 * ─── Derivar, não gravar (o mesmo caminho do #720) ────────────────────────
 *
 * `estaPresente` responde na hora da PERGUNTA, a partir de um carimbo. Não há
 * cron de expiração e não há coluna booleana "está presente": um campo desses
 * seria mais um estado sincronizado por rodada periódica — o anti-pattern 5 da
 * doutrina, que é exatamente o que o #720 removeu do plantão. Consequência
 * direta: fechar a aba não escreve nada no banco, e mesmo assim a pessoa some da
 * lista de presentes dentro do prazo, sozinho.
 *
 * ─── Custo, medido ────────────────────────────────────────────────────────
 *
 * Um sinal por aba a cada `INTERVALO_DO_SINAL_SEGUNDOS` — 60 s, não "a cada
 * poucos segundos". O número de escritas por turno sai daqui e vai medido para
 * o corpo do PR (ver `tests/unit/presenca-do-atendente.test.ts`, que conta as
 * batidas de um turno de 8 h simuladas sobre ESTAS constantes).
 *
 * A alternativa considerada foi o Realtime presence do Supabase (presença em
 * memória do servidor de Realtime, zero escrita no banco). Ela não resolve o
 * problema DOS LEITORES deste produto: roster (`/api/v1/attendants/
 * availability`), capacidade do agente (`crm_list_available_attendants`) e o
 * painel de gestão leem do BANCO, por service role, sem socket — para eles
 * enxergarem a presença, ela teria de ser copiada para o banco de qualquer
 * forma, o que devolve a escrita e ainda acrescenta uma segunda sessão de
 * WebSocket por aba. Ficou a escrita espaçada, que é a única forma que TODOS os
 * leitores declarados conseguem ler.
 */

/**
 * Espaçamento entre dois sinais da MESMA aba. É o teto de custo: uma aba
 * escreve no máximo uma linha (uma coluna) a cada minuto, e nenhuma escrita
 * enquanto a aba não existir.
 */
export const INTERVALO_DO_SINAL_SEGUNDOS = 60;

/**
 * Por quanto tempo um sinal ainda vale.
 *
 * Três vezes o intervalo, de propósito: uma batida perdida (rede oscilando,
 * timer atrasado pelo navegador em segundo plano) não pode piscar "sem sinal"
 * para quem está sentado na frente da tela. Com 3×, duas perdas seguidas ainda
 * deixam a pessoa visível — e fechar a aba some em até 3 min.
 */
export const PRESENCA_EXPIRA_SEGUNDOS = 180;

/**
 * O atendente tem sinal de presença válido NESTE instante?
 *
 * Pressuposto declarado: a presença é do NAVEGADOR, não do teclado. Aba aberta
 * em segundo plano conta como presente — o contrário diria que a pessoa sumiu
 * porque outra janela estava em foco, e rotear para longe de quem está na
 * máquina é o erro caro. Quem não tem sinal é quem fechou a aba, o navegador,
 * ou perdeu a rede.
 */
export function estaPresente(
  ultimoSinalEm: string | Date | null | undefined,
  now: Date,
): boolean {
  if (ultimoSinalEm === null || ultimoSinalEm === undefined) return false;
  const instante = ultimoSinalEm instanceof Date ? ultimoSinalEm : new Date(ultimoSinalEm);
  const ms = instante.getTime();
  // Carimbo ilegível não vira "presente": na dúvida, a resposta honesta é "não
  // sei quando foi o último sinal" — e o leitor mostra isso como sem sinal.
  if (Number.isNaN(ms)) return false;
  // Negativo (relógio do cliente adiantado em relação ao servidor) conta como
  // presente: a pergunta é "houve sinal recente?", não "quando exatamente".
  return now.getTime() - ms <= PRESENCA_EXPIRA_SEGUNDOS * 1000;
}

/**
 * A aba deve mandar o sinal agora? (o espaçamento, do lado do EMISSOR)
 *
 * Fica aqui, e não dentro do hook, porque é a regra que define o CUSTO: quem
 * responde "quantas escritas por turno isto gera" é esta função, testável com
 * relógio injetado. O hook só a chama a cada tique.
 */
export function deveEmitirSinal(input: { ultimoEnvioEm: Date | null; now: Date }): boolean {
  if (!input.ultimoEnvioEm) return true;
  return (
    input.now.getTime() - input.ultimoEnvioEm.getTime() >= INTERVALO_DO_SINAL_SEGUNDOS * 1000
  );
}
