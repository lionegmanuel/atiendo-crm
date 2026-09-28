/**
 * Os MARCADORES em uso e QUEM TRABALHA na empresa — as duas leituras que fazem
 * o agente organizar a operação sem inventar vocabulário nem pessoa.
 *
 * ⚠️ POR QUE LISTAR MARCADOR RESOLVE MAIS DO QUE CRIAR. `crm_manage_tags` já
 * aplica marcador livre — o agente sempre pôde "criar" um digitando um nome
 * novo. O defeito real é o oposto: sem enxergar o que já existe, ele escreve
 * `cliente-vip` numa conversa e `vip` na seguinte, e o filtro do dono da loja
 * passa a mentir sobre quantos clientes VIP ele tem. A cura é a LISTA, não um
 * segundo escritor.
 *
 * ⚠️ NÃO HÁ ESCRITA NO VOCABULÁRIO CANÔNICO, E É DECISÃO. Os marcadores
 * "oficiais" moram em `organizations.settings.canonical_conversation_tags`, que
 * hoje tem rota de LEITURA (`/api/v1/conversation-tags`) e **nenhuma tela para
 * ver ou mudar**. Deixar o agente escrever ali criaria configuração alterável só
 * por quem lê o banco — exatamente o invariante 6 da doutrina do sistema vivo
 * ("toda configuração tem superfície"). Registrado no HANDOFF: a superfície vem
 * antes do escritor.
 */
import { ApiError } from "@/lib/api/types";
import { canonicalConversationTagsSchema } from "@/lib/schemas/settings";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";

export interface MarcadorEmUso {
  marcador: string;
  /** Quantas conversas o carregam agora. */
  conversas: number;
  /** `true` = está no vocabulário oficial da empresa; `false` = nasceu no uso. */
  oficial: boolean;
}

/**
 * O vocabulário oficial mais o que de fato está em uso, num só lugar.
 *
 * ⚠️ AS DUAS FONTES JUNTAS, DE PROPÓSITO. Só o oficial esconderia os marcadores
 * que a operação inventou e usa todo dia (que são justamente os que o agente
 * precisa reaproveitar); só os em uso esconderia o vocabulário que a empresa
 * declarou e ninguém aplicou ainda. Quem lê precisa das duas respostas para não
 * criar a quarta variação de "urgente".
 *
 * O teto existe porque isto entra no contexto de um modelo: uma organização com
 * mil marcadores gastaria o contexto inteiro numa lista que ninguém lê até o fim.
 */
export async function listarMarcadores(
  deps: DepsDaOperacao,
  opts: { limite?: number } = {},
): Promise<MarcadorEmUso[]> {
  const limite = opts.limite ?? 60;

  const { data: org, error: orgErr } = await deps.supabase
    .from("organizations")
    .select("settings")
    .eq("id", deps.organizationId)
    .maybeSingle();
  if (orgErr) throw new ApiError(500, "internal_error", undefined, deps.requestId, orgErr.message);

  const oficiais = new Set<string>(
    canonicalConversationTagsSchema.parse(
      (org?.settings as Record<string, unknown> | null)?.["canonical_conversation_tags"] ?? [],
    ),
  );

  // ⚠️ CONTAGEM EM JS, e não com um `unnest` no banco: `tags` é `text[]` e o
  // PostgREST não agrega. Uma RPC nova só para isto seria mais schema para o
  // clone atualizar; a leitura é limitada e a org tem conversas na casa dos
  // milhares, não dos milhões. Se um dia doer, vira índice GIN + RPC — e o
  // contrato desta função não muda.
  const { data: conversas, error: convErr } = await deps.supabase
    .from("conversations")
    .select("tags")
    .eq("organization_id", deps.organizationId)
    .limit(2000);
  if (convErr) {
    throw new ApiError(500, "internal_error", undefined, deps.requestId, convErr.message);
  }

  const contagem = new Map<string, number>();
  for (const c of (conversas ?? []) as unknown as Array<{ tags: string[] | null }>) {
    for (const t of c.tags ?? []) contagem.set(t, (contagem.get(t) ?? 0) + 1);
  }
  for (const oficial of oficiais) {
    if (!contagem.has(oficial)) contagem.set(oficial, 0);
  }

  return [...contagem.entries()]
    .map(([marcador, conversas_]) => ({
      marcador,
      conversas: conversas_,
      oficial: oficiais.has(marcador),
    }))
    // Os mais usados primeiro: é a ordem em que alguém decidiria reaproveitar.
    .sort((a, b) => b.conversas - a.conversas || a.marcador.localeCompare(b.marcador))
    .slice(0, limite);
}

export interface PessoaDoTime {
  user_id: string;
  papel: string;
  /** `true` enquanto o convite não foi aceito — quem ainda não pode receber trabalho. */
  convite_pendente: boolean;
  desde: string;
}

/**
 * Quem trabalha aqui e com que papel.
 *
 * ⚠️ SEM E-MAIL, SEM NOME, SEM ÚLTIMO ACESSO — e a rota REST irmã devolve os
 * três. A diferença é o destinatário: o que sai daqui entra no contexto de um
 * modelo de linguagem e pode ser repetido numa conversa com um cliente. O
 * agente precisa saber A QUEM direcionar (o `user_id` que
 * `crm_assign_conversation` consome) e QUEM PODE receber (o papel); o e-mail do
 * atendente não participa de nenhuma dessas duas decisões.
 *
 * ⚠️ SÓ LEITURA. Mudar papel de alguém é RBAC e está fora do escopo desta wave
 * por decisão do despacho — e continua sendo, porque promover um colega é a
 * definição de mudança que ninguém quer descobrir depois.
 */
export async function listarTime(deps: DepsDaOperacao): Promise<PessoaDoTime[]> {
  const { data, error } = await deps.supabase
    .from("user_organizations")
    .select("user_id, role, accepted_at, created_at")
    .eq("organization_id", deps.organizationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => ({
    user_id: m.user_id as string,
    papel: m.role as string,
    convite_pendente: m.accepted_at === null,
    desde: m.created_at as string,
  }));
}
