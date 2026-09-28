/**
 * O CASO SÓ NASCE DO MOTOR — migration 0279.
 *
 * ## O defeito
 *
 * `agent_cases`, `agent_case_events` e `conversation_assignment_events` nasceram
 * graváveis por QUALQUER membro da organização, pelas DUAS origens que o
 * baseline tem:
 *
 *   (A) o GRANT — `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
 *       "authenticated"` (`supabase/baseline.sql:4727`) vale para toda tabela
 *       criada DEPOIS dele, e as três são de apêndice;
 *   (B) a POLICY — `for all` em `agent_cases`, `for insert` em
 *       `agent_case_events` e `cae_insert`, todas sem papel mínimo.
 *
 * O que se pagava: `agent_cases` guarda o título, o resumo e o bloqueio que a IA
 * escreveu sobre o atendimento de uma pessoa — o texto que a equipe lê para
 * decidir. Um `viewer` escrevia essa linha falando direto com o PostgREST, com o
 * JWT dele. E um INSERT forjado em `conversation_assignment_events` faz o
 * histórico de dono da conversa dizer que alguém assumiu o que ninguém assumiu.
 *
 * ## Por que as duas origens, e não uma
 *
 * Os dois CONTROLES abaixo medem isso, e não é simetria decorativa:
 *
 *   · com o grant de volta E uma policy de INSERT, a escrita PASSA — é a
 *     simulação do estado anterior à 0279, e sem ela um INSERT malformado
 *     (coluna NOT NULL esquecida) deixaria toda a sonda verde por nada;
 *   · com a policy de volta e o revoke MANTIDO, a escrita segue barrada — o
 *     revoke sozinho já basta para o PostgREST. Ele é a guarda que sobrevive a
 *     alguém recriar uma policy larga depois.
 *
 * A recíproca não vale, e é por isso que o revoke não anda sozinho na migration:
 * a policy sozinha faria o UPDATE casar zero linhas e o PostgREST devolver
 * SUCESSO — "a escrita não pegou" com cara de "a escrita deu certo".
 *
 * ## O que NÃO se fecha aqui
 *
 * SELECT continua aberto nas três: a tela de casos, o MCP e o motor leem. Cada
 * caso de escrita barrada vem colado do seu controle de LEITURA, porque um
 * `permission denied` no INSERT junto com uma leitura que também quebrou não
 * seria conserto — seria a feature morta.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

// Namespace próprio (02790000-), como em `atrito-metrics` e no bloco `dddddddd`
// de `gov-3-assignment-events`: a semente é idempotente E não colide com a de
// outro arquivo rodando em paralelo no mesmo banco.
const ORG = "02790000-0000-4000-8000-000000000001";
const AGENTE = "02790000-1111-4000-8000-000000000001";
const VIEWER = "02790000-1111-4000-8000-000000000002";
const SESSAO = "02790000-2222-4000-8000-000000000001";
const CONTATO_LEITURA = "02790000-3333-4000-8000-000000000001";
const CONTATO_CLAIM = "02790000-3333-4000-8000-000000000002";
/** Conversa só de leitura — nenhum caso a reivindica, então ela segue sem dono. */
const CONVERSA = "02790000-4444-4000-8000-000000000001";
/** Conversa reservada ao controle positivo de `fn_conversation_assign`. */
const CONVERSA_CLAIM = "02790000-4444-4000-8000-000000000002";
const CASO = "02790000-5555-4000-8000-000000000001";
const EVENTO_DO_CASO = "02790000-6666-4000-8000-000000000001";

/** Marcador das linhas de resultado: o psql também imprime BEGIN, SET, GRANT… */
const MARCA = "SONDA|";

/** Roda `corpo` numa transação DESFEITA e devolve só as linhas marcadas. */
function sondasDesfeitas(corpo: string): string[] {
  return sql(`begin;\n${corpo}\nrollback;`)
    .split("\n")
    .filter((linha) => linha.startsWith(MARCA))
    .map((linha) => linha.slice(MARCA.length));
}

/**
 * O prefixo que põe a sessão no mesmo lugar em que o PostgREST põe a de um
 * usuário logado: papel `authenticated` + `request.jwt.claims`, que é o caminho
 * exato que `auth.uid()` e as policies de produção leem.
 */
function comoMembro(userId: string, local = false): string {
  return `set ${local ? "local " : ""}role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', ${local});`;
}

function contaComoMembro(userId: string, consulta: string): number {
  const saida = sql(`${comoMembro(userId)}\n${consulta};`).trim();
  const ultima = saida.split("\n").at(-1) ?? "";
  if (!/^\d+$/.test(ultima)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(ultima);
}

/** Devolve o erro do Postgres, ou `null` quando o comando PASSOU. */
function erroDo(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/**
 * Afirma que o Postgres recusou por PRIVILÉGIO.
 *
 * O modo de falha que interessa é `erroDo` devolver `null`: o comando passou. Um
 * `toContain` sobre `null` reprovaria com uma mensagem que não fala de exposição
 * nenhuma — daí a asserção em dois passos.
 */
function esperaBarradoPorPrivilegio(userId: string, dml: string): void {
  const erro = erroDo(`${comoMembro(userId)}\n${dml};`);
  expect(erro, `um membro executou "${dml}" SEM erro — a tabela está exposta`).not.toBeNull();
  expect(erro).toContain("permission denied");
}

/** Privilégios que o papel tem NA TABELA, direto do catálogo. */
function privilegiosDe(papel: string, tabela: string): string[] {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = '${tabela}' and grantee = '${papel}';
  `)
    .trim()
    .split(",")
    .filter(Boolean);
}

/** Policies da tabela, como `nome:comando`, com o comando em letra por extenso. */
function policiesDe(tabela: string): string[] {
  return sql(`
    select coalesce(string_agg(policyname || ':' || cmd, ',' order by policyname), '')
      from pg_policies where schemaname = 'public' and tablename = '${tabela}';
  `)
    .trim()
    .split(",")
    .filter(Boolean);
}

const TABELAS = ["agent_cases", "agent_case_events", "conversation_assignment_events"] as const;

/** O INSERT que um membro tentaria pelo PostgREST, um por tabela. */
const ESCRITA_FORJADA: Record<(typeof TABELAS)[number], string> = {
  agent_cases: `insert into public.agent_cases
      (organization_id, conversation_id, title, summary, blocker)
    values ('${ORG}', '${CONVERSA}', 'Forjado', 'Resumo forjado', 'Bloqueio forjado')`,
  agent_case_events: `insert into public.agent_case_events
      (organization_id, case_id, kind, actor_kind, body)
    values ('${ORG}', '${CASO}', 'human_replied', 'human', 'Forjado')`,
  conversation_assignment_events: `insert into public.conversation_assignment_events
      (organization_id, conversation_id, to_user_id, changed_by, reason)
    values ('${ORG}', '${CONVERSA}', '${VIEWER}', '${VIEWER}', 'claim')`,
};

/**
 * O mesmo INSERT forjado de `agent_cases`, mas num status TERMINAL — o que não
 * aciona `trg_agent_case_opened`. Serve ao controle positivo de privilégio, que
 * precisa medir a tranca do GRANT sem esbarrar na reserva do `emit_event`.
 */
const ESCRITA_FORJADA_TERMINAL = `insert into public.agent_cases
      (organization_id, conversation_id, title, summary, blocker, status)
    values ('${ORG}', '${CONVERSA}', 'Forjado', 'Resumo forjado', 'Bloqueio forjado', 'resolved')`;

/** A leitura que a tela faz, uma por tabela — o controle de cada caso de escrita. */
const LEITURA: Record<(typeof TABELAS)[number], string> = {
  agent_cases: `select count(*) from public.agent_cases where id = '${CASO}'`,
  agent_case_events: `select count(*) from public.agent_case_events where id = '${EVENTO_DO_CASO}'`,
  conversation_assignment_events: `select count(*) from public.conversation_assignment_events
     where conversation_id = '${CONVERSA}'`,
};

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${AGENTE}', 'caso-0279-agente@invariant.test'),
      ('${VIEWER}', 'caso-0279-viewer@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'caso-0279', 'Caso 0279 Invariant', 'Caso 0279')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENTE}', '${ORG}', 'agent', now()),
      ('${VIEWER}', '${ORG}', 'viewer', now())
      on conflict do nothing;
    -- DO + exception (não ON CONFLICT): channel_sessions tem unique DEFERRABLE
    -- (phone_per_org), que ON CONFLICT sem arbiter rejeita, e o arbiter (id) não
    -- cobre a corrida no unique de waha_session_name entre arquivos paralelos.
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'caso-0279', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    -- Um contato por conversa: uniq_conversations_1to1_per_contact_session
    -- (migration 0027) admite UMA conversa 1:1 por (org, contato, sessão).
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_LEITURA}', '${ORG}', 'Caso 0279 Contato Leitura'),
      ('${CONTATO_CLAIM}', '${ORG}', 'Caso 0279 Contato Claim')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA}', '${ORG}', '${CONTATO_LEITURA}', '${SESSAO}', 'open'),
      ('${CONVERSA_CLAIM}', '${ORG}', '${CONTATO_CLAIM}', '${SESSAO}', 'open')
      on conflict do nothing;
    insert into public.agent_cases (id, organization_id, conversation_id, title, summary, blocker)
      values ('${CASO}', '${ORG}', '${CONVERSA}', 'Caso do motor', 'Resumo do motor', 'Falta decisão')
      on conflict do nothing;
    insert into public.agent_case_events (id, organization_id, case_id, kind, actor_kind, body)
      values ('${EVENTO_DO_CASO}', '${ORG}', '${CASO}', 'opened', 'agent', 'Aberto pelo motor')
      on conflict do nothing;
    insert into public.conversation_assignment_events
        (organization_id, conversation_id, to_user_id, changed_by, reason)
      select '${ORG}', '${CONVERSA}', '${AGENTE}', '${AGENTE}', 'routing'
       where not exists (select 1 from public.conversation_assignment_events
                          where conversation_id = '${CONVERSA}');
  `);
});

describe("0279 — a escrita das três tabelas do caso sai de `authenticated`", () => {
  it.each(TABELAS)("a semente de `%s` existe — controle de vacuidade da sonda", (tabela) => {
    // Sem isto, uma semente que não entrou faria toda leitura devolver 0 e os
    // casos abaixo afirmariam "o membro não escreve" sobre uma tabela vazia,
    // sem nunca ter provado que ele ainda LÊ.
    const total = sql(`select count(*) from public.${tabela} where organization_id = '${ORG}';`);
    expect(Number(total.trim().split("\n").at(-1)), `semente de ${tabela} vazia`).toBeGreaterThan(0);
  });

  it.each(TABELAS)("`authenticated` não tem INSERT, UPDATE, DELETE nem TRUNCATE em `%s`", (tabela) => {
    // O privilégio é o que SOBRA no dia em que alguém acrescentar uma policy
    // larga de volta — medi-lo é medir a guarda que não depende de policy.
    const privilegios = privilegiosDe("authenticated", tabela);
    expect(privilegios.length, `sonda cega: zero privilégios lidos de ${tabela}`).toBeGreaterThan(0);
    expect(privilegios).toContain("SELECT");
    for (const proibido of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(privilegios, `${tabela} ainda concede ${proibido} a authenticated`).not.toContain(
        proibido,
      );
    }
  });

  it.each(TABELAS)("`anon` não tem escrita em `%s` — a anon key vai para o browser", (tabela) => {
    for (const proibido of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(privilegiosDe("anon", tabela)).not.toContain(proibido);
    }
  });

  it("(a) um membro NÃO insere em `agent_cases`, e CONTINUA lendo", () => {
    esperaBarradoPorPrivilegio(VIEWER, ESCRITA_FORJADA.agent_cases);
    esperaBarradoPorPrivilegio(AGENTE, ESCRITA_FORJADA.agent_cases);
    expect(contaComoMembro(AGENTE, LEITURA.agent_cases)).toBe(1);
  });

  it("(b) um membro NÃO insere em `agent_case_events`, e CONTINUA lendo", () => {
    esperaBarradoPorPrivilegio(VIEWER, ESCRITA_FORJADA.agent_case_events);
    expect(contaComoMembro(AGENTE, LEITURA.agent_case_events)).toBe(1);
  });

  it("(c) um membro NÃO insere em `conversation_assignment_events`, e CONTINUA lendo", () => {
    // Sem isto, um `viewer` insere {conversation_id, to_user_id} pelo PostgREST e
    // o histórico de dono passa a dizer que alguém assumiu o atendimento.
    esperaBarradoPorPrivilegio(VIEWER, ESCRITA_FORJADA.conversation_assignment_events);
    expect(
      contaComoMembro(AGENTE, LEITURA.conversation_assignment_events),
    ).toBeGreaterThanOrEqual(1);
  });

  it("CONTROLE: com o GRANT e uma policy de volta, o mesmo INSERT PASSA", () => {
    // Reproduz o estado anterior à 0279 numa transação desfeita. Sem este caso,
    // um INSERT malformado (uma coluna NOT NULL esquecida) devolveria erro por
    // outro motivo e os casos (a)–(c) ficariam verdes sem medir privilégio.
    //
    // ⚠️ `status = 'resolved'` NÃO é detalhe: o caso nasce `awaiting_human` por
    // default, e aí `trg_agent_case_opened` chama `emit_event('ai.case_opened')`
    // — que a MESMA migration reservou. O INSERT então morre na SEGUNDA guarda e
    // este controle mediria a reserva em vez do privilégio, que é o oposto do
    // que ele existe para fazer. Um caso que nasce terminal não dispara o
    // gatilho de abertura (`when (new.status in ('awaiting_human','awaiting_lead'))`,
    // baseline.sql). A interação entre as duas guardas tem caso próprio abaixo.
    const [inseridas] = sondasDesfeitas(`
      grant insert on public.agent_cases to authenticated;
      create policy tmp_0279_insert on public.agent_cases
        for insert to authenticated with check (true);
      ${comoMembro(VIEWER, true)}
      with w as (${ESCRITA_FORJADA_TERMINAL} returning 1)
      select '${MARCA}' || count(*) from w;
    `);
    expect(inseridas, "a simulação do estado pré-0279 não reproduz a escrita").toBe("1");
  });

  it("as DUAS guardas se somam: com o GRANT de volta, o caso ABERTO ainda morre na reserva", () => {
    // Achado da primeira rodada de `test:db` desta onda, e o motivo de ele virar
    // caso: mesmo que alguém devolva o GRANT e uma policy larga — por engano, ou
    // por um `grant all` futuro do default privileges — um caso forjado que nasce
    // ABERTO continua barrado, porque o gatilho de abertura emite um evento que a
    // reserva do `emit_event` recusa a quem tem `auth.uid()`.
    //
    // É a diferença entre uma tranca e duas. O erro muda de `permission denied`
    // para `reserved_message_received`, e é isso que este caso prende: se alguém
    // tirar a reserva, ele fica verde por outro motivo — e o (d) abaixo vermelho.
    const erro = erroDo(`
      begin;
      grant insert on public.agent_cases to authenticated;
      create policy tmp_0279_insert_aberto on public.agent_cases
        for insert to authenticated with check (true);
      ${comoMembro(VIEWER, true)}
      ${ESCRITA_FORJADA.agent_cases};
      rollback;
    `);
    expect(erro, "com o grant de volta, o caso aberto entrou sem nenhuma guarda").not.toBeNull();
    expect(erro).toContain("reserved_message_received");
  });

  it("CONTROLE: com a POLICY de volta e o revoke MANTIDO, o INSERT segue barrado", () => {
    // O revoke sozinho já basta para o PostgREST — é a guarda que sobrevive a
    // alguém recriar uma policy larga depois. (A recíproca não vale: a policy
    // sozinha faria o UPDATE casar zero linhas e o PostgREST devolver SUCESSO,
    // que é por que a migration faz as duas coisas.)
    const erro = erroDo(`
      begin;
      create policy tmp_0279_insert on public.agent_cases
        for insert to authenticated with check (true);
      ${comoMembro(VIEWER, true)}
      ${ESCRITA_FORJADA.agent_cases};
      rollback;
    `);
    expect(erro, "a policy sozinha reabriu a escrita — o revoke não pegou").not.toBeNull();
    expect(erro).toContain("permission denied");
  });

  it.each(TABELAS)("`%s` fica sem policy permissiva de escrita — a origem (B) também fecha", (tabela) => {
    const escrita = policiesDe(tabela).filter((p) => /:(INSERT|UPDATE|DELETE|ALL)$/.test(p));
    expect(escrita, `${tabela} ainda tem policy de escrita: ${escrita.join(", ")}`).toEqual([]);
  });

  it.each(TABELAS)("`%s` mantém RLS ligada e a policy de leitura", (tabela) => {
    const rls = sql(`
      select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = '${tabela}';
    `).trim();
    expect(rls, `${tabela} perdeu a RLS`).toBe("t");
    expect(policiesDe(tabela).filter((p) => p.endsWith(":SELECT")).length).toBeGreaterThan(0);
  });
});

describe("0279 — `emit_event` reserva os eventos de caso ao servidor", () => {
  const RESERVADOS = ["ai.case_opened", "ai.case_closed"] as const;

  it.each(RESERVADOS)("(d) um membro NÃO emite `%s` — 42501", (tipo) => {
    const erro = erroDo(`
      ${comoMembro(AGENTE)}
      select public.emit_event('${tipo}', 'agent_case', '${CASO}'::uuid,
        '{}'::jsonb, '{}'::jsonb, '${ORG}'::uuid);
    `);
    expect(erro, `um membro emitiu ${tipo} SEM erro`).not.toBeNull();
    // A mensagem fica com o nome herdado: renomeá-la é mudança de contrato
    // observável, e não medimos se alguém a trata por nome.
    expect(erro).toContain("reserved_message_received");
  });

  it("(d) CONTROLE: o MESMO membro emite um tipo não reservado", () => {
    // Sem isto, um 42501 vindo de outro lugar (membership revogada, suporte em
    // modo somente leitura) leria exatamente como "a reserva funcionou".
    const [emitido] = sondasDesfeitas(`
      ${comoMembro(AGENTE, true)}
      select '${MARCA}' || (public.emit_event('ai.case_sonda', 'agent_case', '${CASO}'::uuid,
        '{}'::jsonb, '{}'::jsonb, '${ORG}'::uuid) is not null);
    `);
    // `'SONDA|' || <boolean>` sai como `true`, e não como o `t` que o psql
    // imprimiria para uma coluna booleana: a concatenação converte pelo tipo
    // TEXT. Medido na primeira rodada desta suíte.
    expect(emitido, "o membro não emite nem tipo livre — o 42501 acima não prova a reserva").toBe(
      "true",
    );
  });

  it.each(RESERVADOS)("(d) o SERVIDOR emite `%s` e a linha entra no event_log", (tipo) => {
    // `service_role` não tem `auth.uid()`, que é a condição da reserva: o motor
    // segue emitindo. Numa transação desfeita para não deixar evento solto no
    // banco compartilhado da suíte.
    //
    // A contagem é por `entity_id` PRÓPRIO, e não pelo caso da fixture: o caso
    // da fixture nasce `awaiting_human`, e o gatilho de abertura JÁ emitiu um
    // `ai.case_opened` para ele no seed. Contar por tipo devolvia 2 e lia como
    // defeito — medido na primeira rodada desta suíte.
    const alvo = "02790000-7777-4000-8000-000000000001";
    const [gravadas] = sondasDesfeitas(`
      set local role service_role;
      select public.emit_event('${tipo}', 'agent_case', '${alvo}'::uuid,
        '{}'::jsonb, '{}'::jsonb, '${ORG}'::uuid);
      select '${MARCA}' || count(*) from public.event_log
       where organization_id = '${ORG}' and event_type = '${tipo}'
         and entity_id = '${alvo}';
    `);
    expect(gravadas, `o servidor não conseguiu emitir ${tipo}`).toBe("1");
  });
});

describe("0279 — o que tinha de continuar funcionando", () => {
  it("(e) CONTROLE POSITIVO: `fn_conversation_assign` como `agent` ainda grava o evento", () => {
    // Este é o caso que diz se a 0279 quebrou o produto. As cinco rotas de troca
    // de dono (claim, transfer, release) chamam esta RPC com o client de SESSÃO;
    // o INSERT em conversation_assignment_events é feito DENTRO dela, que é
    // `security definer` e executa com o privilégio do DONO — por isso o revoke
    // de `authenticated` não a alcança. Se um dia alguém a tornar `security
    // invoker`, é AQUI que aparece.
    const antes = contaComoMembro(
      AGENTE,
      `select count(*) from public.conversation_assignment_events
        where conversation_id = '${CONVERSA_CLAIM}'`,
    );

    // `p_enforce_expected = false` de propósito: o que este caso mede é se a
    // auditoria continua sendo gravada, não a trava otimista (que tem dono em
    // gov-3-assignment-events.test.ts). Com `true`, uma segunda execução contra
    // o mesmo banco encontraria a conversa já reivindicada, a função devolveria
    // zero linhas e o caso ficaria vermelho por estado herdado, não por defeito.
    const atribuidas = contaComoMembro(
      AGENTE,
      `select count(*) from public.fn_conversation_assign(
         '${ORG}'::uuid, '${CONVERSA_CLAIM}'::uuid, '${AGENTE}'::uuid, 'claim', null::uuid, false)`,
    );
    expect(atribuidas, "a RPC de troca de dono não atribuiu a conversa").toBe(1);

    const depois = contaComoMembro(
      AGENTE,
      `select count(*) from public.conversation_assignment_events
        where conversation_id = '${CONVERSA_CLAIM}' and reason = 'claim'
          and to_user_id = '${AGENTE}'`,
    );
    expect(depois, "a RPC atribuiu a conversa e NÃO gravou a auditoria").toBe(antes + 1);
  });

  it("(f) `agent_cases` fica com ZERO policies `support_write_*` — é server-only", () => {
    // A 0274 varre o catálogo: tabela gravável por `authenticated` recebe as três
    // restritivas; tabela só do servidor recebe NENHUMA, que é o contrato mais
    // restritivo. A migration chama `fn_aplicar_travas_de_suporte()` no fim, e é
    // isso que este caso mede — tirar a chamada deixa as três órfãs aqui.
    for (const tabela of TABELAS) {
      const orfas = policiesDe(tabela).filter((p) => p.startsWith("support_write_"));
      expect(orfas, `${tabela} ficou com trava de suporte órfã: ${orfas.join(", ")}`).toEqual([]);
    }
  });

  it("(f) CONTROLE: a varredura de travas de suporte RODOU — outras tabelas as têm", () => {
    // Sem este controle, um banco em que `fn_aplicar_travas_de_suporte()` nunca
    // rodou passaria no caso acima por vacuidade: zero travas em toda parte.
    const comTrava = sql(`
      select count(*) from pg_policies
       where schemaname = 'public' and policyname = 'support_write_insert';
    `).trim();
    expect(Number(comTrava), "nenhuma tabela tem trava de suporte — a varredura não rodou").
      toBeGreaterThan(10);
  });
});
