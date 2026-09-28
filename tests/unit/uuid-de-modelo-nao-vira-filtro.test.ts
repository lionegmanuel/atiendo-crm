import { describe, expect, it } from "vitest";
import { z } from "zod";

import { allTools } from "@/lib/mcp/tools";
import { ehUuidDeAterro, higienizarUuidsDeAterro } from "@/lib/mcp/uuid-de-aterro";

/**
 * O UUID QUE O MODELO INVENTA NÃO PODE VIRAR FILTRO — a guarda da CLASSE.
 *
 * ═══ O defeito, medido em produção ═══════════════════════════════════════════
 *
 * Um agente de clínica tentou marcar Botox numa quinta-feira e não conseguiu,
 * duas vezes. Ele tinha feito tudo certo — descobriu os tipos de atendimento,
 * achou o slug, foi consultar horário. O audit mostra o argumento:
 *
 *     crm_find_free_slots { event_type_slug: "hof-e-botox",
 *                           owner_user_id: "00000000-0000-0000-0000-000000000000" }
 *
 * Campo OPCIONAL, preenchido com o uuid nil em vez de omitido. Do outro lado,
 * `input.owner_user_id ?? tipo.default_owner_user_id` não caiu no default,
 * porque o valor não era `undefined`. A agenda de um usuário que não existe
 * voltou vazia, o produto concluiu "ninguém publicou horário", e o agente fez o
 * certo sobre o dado errado: não inventou horário e abriu caso para um humano.
 *
 * A paciente ficou sem consulta. As duas chamadas estão no audit com
 * `success: true` — não havia erro em lugar nenhum para investigar.
 *
 * ═══ Por que a guarda é da CLASSE, e não daquele campo ═══════════════════════
 *
 * Porque o campo não tem nada de especial. Medido no catálogo inteiro: são 60+
 * ferramentas e dezenas de campos de uuid que aceitam ausência, e ANTES do
 * conserto todos vazavam a mesma sentinela. Entre eles, dois que fazem pior que
 * a agenda:
 *
 *   - `crm_search_knowledge.assistente_id` — o nil sobrescreve a identidade do
 *     próprio agente (`?? ctx.actor.id`), e ele conclui que não tem acervo. O
 *     sintoma é a IA responder "não sei" com a base publicada ao lado.
 *   - `crm_create_lead` / `crm_update_lead.owner_user_id` — a coluna não tem FK,
 *     então o dono fantasma PERSISTE: o negócio some do filtro por dono e das
 *     métricas. A leitura errada morre no próximo turno; esta fica no banco.
 *
 * Consertar por instância deixaria o próximo campo nascer fora. Esta guarda
 * pergunta a propriedade a TODO o catálogo, e a pergunta é feita ao SCHEMA.
 *
 * ═══ Por que só a nil e a max, e não "id que não existe" ════════════════════
 *
 * Porque o conjunto do que o Zod deixa passar é FECHADO e tem essas duas
 * formas: `z.string().uuid()` as allowlista em letra, por serem UUIDs válidos
 * pela RFC 9562. Todo o resto do lixo (`""`, `"null"`, `"none"`) já é recusado
 * no `safeParse`.
 *
 * Um uuid v4 ALUCINADO, bem formado, fica de fora de propósito: nesta fronteira
 * ele é indistinguível de um id legítimo, e quem trata aquele caso é a recusa
 * nomeada lá embaixo ("não encontrei esse compromisso"), que já existe e ensina
 * o modelo. Guarda de borda não decide negócio.
 */

/** As sentinelas — o que um modelo escreve quando quer dizer "não sei". */
const NIL = "00000000-0000-0000-0000-000000000000";
const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";
/** A nil vestida de v4, que um modelo "caprichoso" produz. */
const NIL_MASCARADA = "00000000-0000-4000-8000-000000000000";
/** Um uuid legítimo — o controle que separa "sentinela" de "uuid qualquer". */
const BOM = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

type Shape = Record<string, z.ZodTypeAny>;

/** O campo é um uuid? Perguntado ao schema, com controle negativo. */
function ehCampoUuid(s: z.ZodTypeAny): boolean {
  return (
    s.safeParse(BOM).success &&
    !s.safeParse("nao-e-uuid").success &&
    !s.safeParse("zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz").success
  );
}

/** O campo aceita ausência? É isto que separa opcional de obrigatório. */
function aceitaAusencia(s: z.ZodTypeAny): { sim: boolean; valor: unknown } {
  const r = s.safeParse(undefined);
  return { sim: r.success, valor: r.success ? r.data : undefined };
}

interface CampoUuid {
  tool: string;
  campo: string;
  schema: z.ZodTypeAny;
}

function camposDeUuid(): { opcionais: CampoUuid[]; obrigatorios: CampoUuid[] } {
  const opcionais: CampoUuid[] = [];
  const obrigatorios: CampoUuid[] = [];
  for (const t of allTools) {
    for (const [campo, schema] of Object.entries((t.inputSchema ?? {}) as Shape)) {
      if (typeof schema?.safeParse !== "function") continue;
      if (!ehCampoUuid(schema)) continue;
      (aceitaAusencia(schema).sim ? opcionais : obrigatorios).push({ tool: t.name, campo, schema });
    }
  }
  return { opcionais, obrigatorios };
}

describe("o uuid que o modelo inventa não vira filtro", () => {
  it("a varredura ENCONTRA campos — uma lista vazia passaria por vacuidade", () => {
    // O controle. Sem ele, quebrar `ehCampoUuid` deixa a guarda VERDE sobre um
    // conjunto vazio — a forma mais silenciosa de uma guarda morrer. Os pisos
    // são folgados de propósito: o que importa é não ser zero.
    const { opcionais, obrigatorios } = camposDeUuid();
    expect(opcionais.length).toBeGreaterThanOrEqual(20);
    expect(obrigatorios.length).toBeGreaterThanOrEqual(10);
  });

  it("TODO campo de uuid opcional colapsa a sentinela para a ausência", () => {
    // A régua. Não é "vira undefined": um campo `.nullable().default(null)` tem
    // `null` como ausência, e exigir `undefined` dele seria falso positivo. A
    // âncora é o que o PRÓPRIO campo devolve quando o modelo não o manda.
    const vazam: string[] = [];
    for (const { tool, campo, schema } of camposDeUuid().opcionais) {
      const ausente = aceitaAusencia(schema).valor;
      for (const sentinela of [NIL, MAX, NIL_MASCARADA]) {
        const { limpos } = higienizarUuidsDeAterro({ [campo]: schema }, { [campo]: sentinela });
        const depois = schema.safeParse(limpos[campo]);
        if (depois.success && depois.data !== ausente) vazam.push(`${tool}.${campo}`);
      }
    }

    expect(
      [...new Set(vazam)].sort(),
      "estes campos deixam o uuid inventado pelo modelo virar filtro. O efeito não é " +
        "erro: é consulta que casa zero linhas e volta vazia, e o modelo lê o vazio como " +
        '"não existe". Foi assim que uma paciente ficou sem consulta com a agenda livre.',
    ).toEqual([]);
  });

  it("campo OBRIGATÓRIO não é tocado — a recusa que ensina vale mais que o silêncio", () => {
    // Apagar a chave de um campo obrigatório trocaria "não encontrei esse
    // compromisso, confirme com crm_list_appointments" por um erro de protocolo,
    // que o modelo lê pior e que não diz o que fazer em seguida.
    const { obrigatorios } = camposDeUuid();
    for (const { campo, schema } of obrigatorios) {
      const { limpos, descartados } = higienizarUuidsDeAterro({ [campo]: schema }, { [campo]: NIL });
      expect(descartados).toEqual([]);
      expect(limpos[campo]).toBe(NIL);
    }
  });

  it("uuid LEGÍTIMO atravessa intacto — a guarda não pode comer dado bom", () => {
    // O controle positivo do predicado. Sem ele, um `ehUuidDeAterro` que
    // devolvesse `true` para tudo faria os dois casos acima passarem.
    for (const { campo, schema } of camposDeUuid().opcionais) {
      const { limpos, descartados } = higienizarUuidsDeAterro({ [campo]: schema }, { [campo]: BOM });
      expect(descartados).toEqual([]);
      expect(limpos[campo]).toBe(BOM);
    }
  });
});

describe("ehUuidDeAterro — o predicado", () => {
  it("reconhece as formas que o Zod deixa passar", () => {
    expect(ehUuidDeAterro(NIL)).toBe(true);
    expect(ehUuidDeAterro(MAX)).toBe(true);
    expect(ehUuidDeAterro(NIL_MASCARADA)).toBe(true);
    expect(ehUuidDeAterro(MAX.toUpperCase())).toBe(true);
  });

  it("NÃO reconhece uuid legítimo, nem id inexistente bem formado", () => {
    // A fronteira do predicado, e ela é deliberada: "não resolve" é pergunta de
    // negócio, respondida lá embaixo com um desfecho que ensina o modelo.
    expect(ehUuidDeAterro(BOM)).toBe(false);
    expect(ehUuidDeAterro("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(ehUuidDeAterro("")).toBe(false);
    expect(ehUuidDeAterro(undefined)).toBe(false);
    expect(ehUuidDeAterro(42)).toBe(false);
  });

  it("o Zod REALMENTE aceita as sentinelas — é por isso que esta guarda existe", () => {
    // Se um dia o zod passar a recusá-las, este caso cai e a guarda inteira
    // vira redundante. Melhor descobrir por um teste vermelho do que mantendo
    // código que não protege mais nada.
    const uuid = z.string().uuid();
    expect(uuid.safeParse(NIL).success).toBe(true);
    expect(uuid.safeParse(MAX).success).toBe(true);
    expect(uuid.safeParse("").success).toBe(false);
    expect(uuid.safeParse("null").success).toBe(false);
  });
});
