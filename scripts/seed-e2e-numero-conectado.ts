/**
 * Um número de WhatsApp CONECTADO (`status = 'WORKING'`) para as specs que
 * exercitam envio automatizado.
 *
 * ═══ Por que isto precisa de seed, e não da tela ═══
 *
 * Conectar um número de verdade exige ler um QR code no celular. Numa
 * instalação real isso acontece uma vez, à mão; num rig de teste não acontece
 * nunca. Sem uma sessão `WORKING` a tela de automação desabilita TODOS os
 * números no seletor — corretamente, porque mandar mensagem por um número
 * desconectado é o defeito que aquele `disabled` existe para evitar — e a spec
 * não tem o que medir.
 *
 * `seed-e2e-followup-agent.ts` também cria uma sessão, mas ela nasce
 * `STARTING` (o default da coluna): serve para o que aquele seed precisa (uma
 * FK não-nula para publicar agente) e não serve aqui.
 *
 * ═══ O que este número NÃO é ═══
 *
 * Não é um WhatsApp que funciona. O `WAHA_API_BASE_URL` do `.env.e2e` aponta
 * para uma porta vazia, então todo envio por ele MORRE — e isso é proposital:
 * é exatamente a instalação com o WhatsApp fora do ar que o relato de
 * 2026-08-24 descreve, e é sobre esse desfecho que a spec afirma.
 *
 * Idempotente pelo `waha_session_name`. Run: npx tsx scripts/seed-e2e-numero-conectado.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const SESSION_NAME = "e2e-numero-conectado";

interface Creds {
  org_id: string;
  numero_conectado?: { channel_session_id: string };
}

async function main(): Promise<void> {
  // `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts), e o
  // destino é ANUNCIADO: um seed que escreve na nuvem por engano acha os mesmos
  // dados de teste de sempre e termina dizendo "pronto". A linha impressa é o
  // que torna o estrago visível ANTES dele.
  const credenciais = credenciaisSupabaseDeTeste();
  anunciarDestino("seed-e2e-numero-conectado", credenciais);
  const admin = createClient(credenciais.url, credenciais.serviceRole, {
    auth: { persistSession: false },
  });

  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const orgId = creds.org_id;

  const { data: existente } = await admin
    .from("channel_sessions")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("waha_session_name", SESSION_NAME)
    .maybeSingle();

  let id: string;
  if (existente) {
    id = (existente as { id: string }).id;
    // Uma spec anterior pode ter deixado o status em outro valor (o watchdog
    // reconcilia com o WAHA real, que aqui não existe). Reafirma WORKING.
    await admin.from("channel_sessions").update({ status: "WORKING" }).eq("id", id);
  } else {
    const { data, error } = await admin
      .from("channel_sessions")
      .insert({
        organization_id: orgId,
        waha_session_name: SESSION_NAME,
        display_name: "Número conectado (E2E)",
        phone_number: "+5511999990000",
        status: "WORKING",
        webhook_secret_encrypted: "\\x00",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert channel_sessions: ${error?.message}`);
    id = (data as { id: string }).id;
  }

  creds.numero_conectado = { channel_session_id: id };
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
  console.log(`[seed] número conectado (WORKING): ${id}`);

  await garantirJanelaSempreAberta(admin, orgId);
}

/**
 * A JANELA DE ENVIO É ENTRADA DO CENÁRIO, NÃO O RELÓGIO DE PAREDE.
 *
 * ═══ O defeito que esta função existe para fechar ════════════════════════════
 *
 * `automacao-diz-a-verdade` e `webhooks` reprovaram TODA branch cuja execução
 * alcançasse ~22h BRT — inclusive a `main`, e inclusive uma branch que só
 * mexia em documentação, que não tem como quebrar e2e por mérito próprio.
 * Medido pelo horário em que a spec rodou, em 2026-08-30/31:
 *
 *     21:41 BRT -> passou   (main)
 *     21:59 BRT -> falhou   (uma feature branch)
 *     22:00 BRT -> falhou   (main)
 *     22:24 BRT -> falhou   (branch SÓ DE DOCS)
 *
 * A causa é a janela anti-ban do produto, 7h-22h (`PACING_DEFAULTS`), com fim
 * EXCLUSIVO (`insideWindow`: `h >= start && h < end`). Passadas as 22h,
 * `postponeUntil` da ação de WhatsApp adia o envio, o motor grava um run com
 * `status: 'adiado'` e a aba Atividade o rotula **"Aguardando envio"** — que
 * não é "Sucesso" nem "Falhou". A spec então não acha o texto que procura, e o
 * erro sai como `element(s) not found`: um sintoma que não fala de relógio
 * nenhum, e que por isso custou horas a quem foi investigar.
 *
 * ═══ Por que TODAS as sessões da org, e não só a deste seed ══════════════════
 *
 * Porque quem paga o adiamento nem sempre é quem envia. A pré-checagem do
 * motor é **all-or-nothing sobre o evento**: o primeiro adiamento encontrado
 * aborta o evento INTEIRO, inclusive as regras que não mandam mensagem
 * nenhuma. É assim que `webhooks.spec`, cuja ação é só "adicionar tag", caía
 * junto — ela não tem como se adiar sozinha, e era derrubada por uma regra
 * irmã de envio no mesmo gatilho.
 *
 * Abrir só a janela do número deste seed consertaria isso HOJE, porque hoje ele
 * é a única sessão `WORKING` do rig. Isso é verdade por acidente, não por
 * construção: a próxima spec que semear outra sessão reabre o buraco, e reabre
 * contaminando terceiros. Varrer a org custa um `select` e fecha por desenho.
 *
 * ═══ O que isto NÃO é ════════════════════════════════════════════════════════
 *
 * Não é desligar o anti-ban, e não é baixar a régua de asserção nenhuma:
 * "Falhou" continua tendo de aparecer como "Falhou". O caminho do ADIAMENTO
 * segue coberto onde ele é determinístico — `tests/invariants/`, com relógio
 * injetado. O que muda é só isto: a hora em que o CI roda deixa de ser uma
 * entrada escondida do teste.
 */
export async function garantirJanelaSempreAberta(
  admin: ReturnType<typeof createClient>,
  orgId: string,
): Promise<void> {
  const { data: sessoes, error: erroSessoes } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", orgId);
  if (erroSessoes) throw new Error(`select channel_sessions: ${erroSessoes.message}`);

  const linhas = (sessoes ?? []).map((s) => ({
    organization_id: orgId,
    channel_session_id: (s as { id: string }).id,
    // 0..24 abre SEMPRE: `insideWindow` é `h >= start && h < end` sobre uma
    // hora normalizada em 0..23. Os valores são EXPLÍCITOS porque coluna nula
    // cai de volta no default de 7h-22h — que é justamente o que se quer sair.
    window_start_hour: 0,
    window_end_hour: 24,
    // A guarda de domingo roda ANTES da faixa horária: sem ela, o buraco
    // voltaria um dia por semana, e voltaria pior — o dia inteiro.
    allow_sunday: true,
  }));
  if (linhas.length === 0) return;

  const { error } = await admin
    .from("channel_knobs")
    .upsert(linhas as never, { onConflict: "organization_id,channel_session_id" });
  // `throw`, nunca um aviso: um seed que falha calado devolve as specs ao
  // regime antigo, e o vermelho volta a depender da hora — que é exatamente o
  // modo de falha que esta função existe para matar.
  if (error) throw new Error(`upsert channel_knobs: ${error.message}`);
  console.log(`[seed] janela de envio fixada em 0h-24h (domingo liberado) em ${linhas.length} canal(is)`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
