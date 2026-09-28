/**
 * INVOCAÇÃO DE IA SEM AGENTE DONO PRECISA ENTRAR NA AUDITORIA (issue #160).
 *
 * ## O defeito, reportado por @jmpo medindo a própria VPS
 *
 * `ai_invocations` é a fonte das telas de consumo e custo de IA. Ele achou a
 * tabela com **zero linhas** numa instalação com 176 mensagens em 24h, e o log
 * do contêiner repetindo `invalid input syntax for type uuid: ""`.
 *
 * O classificador de sentimento roda MESMO sem agente ativo — lê o agente só
 * para descobrir o threshold e cai no default quando não acha, o que está
 * certo. Mas auditava com `agent_id: agent?.id ?? ""`, e a coluna era
 * `uuid NOT NULL`.
 *
 * ## Por que passou tanto tempo
 *
 * O insert é **fire-and-forget**: `logInvocation` só faz `logger.warn` quando
 * falha. Ninguém vê erro, nada quebra na tela — o custo é pago ao provider e
 * simplesmente não aparece em lugar nenhum do CRM. E "sem agente ativo" não é
 * estado exótico: é o estado normal de quem ainda não publicou o agente.
 *
 * ## O que se guarda aqui
 *
 * O que o worker MANDA, não o que o banco aceita — o banco é vigiado pelo
 * `test:db`. Aqui a asserção é sobre a fronteira: `null` significa "não tem
 * dono" e tem que viajar como `null`, nunca como string vazia, que é a forma
 * que o Postgres recusa.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const inserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { logInvocation } = await import("@/lib/ai/log-invocation");

/** `logInvocation` usa `queueMicrotask`; isto dá o tick para ele rodar. */
async function drenar(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

const BASE = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  conversation_id: null,
  message_id: null,
  invocation_kind: "sentiment_classify" as const,
  model: "anthropic/claude-haiku-4-5",
  prompt_tokens: 10,
  completion_tokens: 5,
  latency_ms: 42,
  cost_cents: 1,
};

describe("auditoria de invocação de IA sem agente dono", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("agent_id null viaja como null, nunca como string vazia", async () => {
    logInvocation({ ...BASE, agent_id: null });
    await drenar();

    expect(inserts).toHaveLength(1);
    expect(
      inserts[0]!.agent_id,
      'string vazia numa coluna uuid faz o insert falhar em silêncio — foi assim que a tabela ficou vazia numa VPS com tráfego real',
    ).toBeNull();
    expect(inserts[0]!.agent_id).not.toBe("");
  });

  it('string vazia é normalizada para null pela PRÓPRIA função', async () => {
    // Este é o caso que de fato vigia o defeito. Medido: com `agent_id:
    // string | null`, um chamador escrevendo `?? ""` passa no typecheck E no
    // teste que só olha `null` — os dois gates cegos ao mesmo tempo. Quem
    // escreve na coluna uuid é esta função; é ela que tem de recusar a forma
    // que o banco recusa, senão o próximo chamador repete o erro.
    logInvocation({ ...BASE, agent_id: "" as unknown as null });
    await drenar();
    expect(inserts[0]!.agent_id).toBeNull();
  });

  it("só espaço em branco também vira null", async () => {
    logInvocation({ ...BASE, agent_id: "   " as unknown as null });
    await drenar();
    expect(inserts[0]!.agent_id).toBeNull();
  });

  it("com agente, o id vai inteiro", async () => {
    // Guarda de vacuidade: sem este caso, um `agent_id: null` fixo passaria no
    // teste acima e apagaria a atribuição de custo de toda invocação com dono.
    logInvocation({ ...BASE, agent_id: "22222222-2222-4222-8222-222222222222" });
    await drenar();
    expect(inserts[0]!.agent_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("a linha entra mesmo sem agente — é custo pago que precisa aparecer", async () => {
    // A alternativa descartada na issue era "não logar quando não há agente":
    // trocaria um bug silencioso por uma lacuna silenciosa. Este caso é o que
    // impede alguém de aplicá-la depois achando que simplifica.
    logInvocation({ ...BASE, agent_id: null, cost_cents: 7 });
    await drenar();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.cost_cents).toBe(7);
  });
});
