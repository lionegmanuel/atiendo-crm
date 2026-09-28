/**
 * O UUID QUE O MODELO INVENTA PARA "NÃO SEI" — e por que ele não pode virar filtro.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 * Um agente de clínica tentou marcar Botox para uma quinta-feira. Ele fez tudo
 * certo: descobriu os tipos de atendimento, achou o slug `hof-e-botox`,
 * consultou os horários livres. Duas tentativas seguidas falharam, e o audit
 * mostra por quê — o argumento que ele mandou:
 *
 *     crm_find_free_slots { event_type_slug: "hof-e-botox",
 *                           owner_user_id: "00000000-0000-0000-0000-000000000000" }
 *
 * O campo é OPCIONAL. O modelo, em vez de omiti-lo, preencheu com o uuid nil —
 * o jeito dele de dizer "não tenho esse dado". E `input.owner_user_id ?? null`
 * só trata `undefined`: o nil passou, virou o dono da agenda em
 * `params.ownerUserId ?? tipo.default_owner_user_id`, a jornada de um usuário
 * que não existe veio vazia, e o produto concluiu que a agenda não estava
 * publicada. O agente então fez o que deve fazer quando não há horário: não
 * inventou nenhum, avisou que a equipe confirmaria, e abriu um caso para um
 * humano. Comportamento certo sobre um dado envenenado.
 *
 * A paciente ficou sem consulta, e não havia erro em lugar nenhum para
 * investigar — as duas chamadas estão no audit com `success: true`.
 *
 * ─── Por que o Zod não pega, e por que isso é bom ───────────────────────────
 *
 * `z.string().uuid()` ACEITA a nil e a max de propósito: as duas são UUIDs
 * válidos pela RFC 9562, e o regex do zod as allowlista em letra, ao lado da
 * forma v1–v8. Não é falha da validação — é a especificação.
 *
 * A consequência é boa para nós: o conjunto do que passa é FECHADO e tem dois
 * elementos. Todo o resto do lixo que um modelo poderia inventar (`""`,
 * `"null"`, `"none"`, `"0"`) já é recusado pelo `safeParse`. Medido no zod
 * deste repo.
 *
 * ⚠️ E um uuid v4 ALUCINADO, bem formado, NÃO entra aqui e não deve entrar: ele
 * é indistinguível de um id legítimo nesta fronteira. Quem trata aquele caso é
 * o desfecho nomeado lá embaixo — "não encontrei esse compromisso" —, que já
 * existe e ensina o modelo. Ampliar este predicado para "id que não resolve"
 * seria mover uma decisão de negócio para dentro de um utilitário de borda.
 */

/** As duas formas que o Zod deixa passar, e as únicas. */
const NIL = "00000000-0000-0000-0000-000000000000";
const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/**
 * ⚠️ A nil COM MÁSCARA DE VERSÃO também entra.
 *
 * Um modelo que "sabe" que uuid v4 tem um `4` e um `8` produz
 * `00000000-0000-4000-8000-000000000000` — todos os dígitos significativos em
 * zero, com os nibbles de versão e variante preenchidos para parecer legítimo.
 * Pela RFC não é a nil; pela intenção é a mesma coisa, e pelo efeito também:
 * não casa com linha nenhuma. Por isso o teste abaixo é sobre os HEX
 * SIGNIFICATIVOS, e não uma comparação com duas constantes.
 */
function todosOsHexIguais(valor: string, digito: string): boolean {
  const hex = valor.toLowerCase().replace(/-/g, "");
  if (hex.length !== 32) return false;
  // Posição 12 é a versão e 16 é a variante: os dois nibbles que um modelo
  // preenche para o valor "parecer" um uuid. Ignorá-los é o que faz este
  // predicado pegar a nil mascarada sem deixar de pegar a nil crua.
  return hex
    .split("")
    .every((c, i) => i === 12 || i === 16 || c === digito);
}

/**
 * Este uuid é a forma que um modelo usa para dizer "não sei"?
 *
 * Só isso — não responde se o id EXISTE. Um id inexistente mas bem formado
 * segue caminho normal e recebe a recusa nomeada de quem sabe respondê-la.
 */
export function ehUuidDeAterro(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const v = valor.trim().toLowerCase();
  if (v === NIL || v === MAX) return true;
  return todosOsHexIguais(v, "0") || todosOsHexIguais(v, "f");
}

/**
 * Apaga do payload as chaves em que o modelo pôs um uuid de aterro — e SÓ as
 * que o schema permite estarem ausentes.
 *
 * ⚠️ APAGA A CHAVE, não escreve `null`. É a diferença entre consertar e trocar
 * de defeito: os call sites fazem `input.owner_user_id ?? tipo.default_owner_user_id`
 * e `input.assistente_id ?? ctx.actor.id`. Com a chave ausente, o `??` cai no
 * lado certo e TODOS eles voltam a funcionar sem que nenhum precise mudar.
 * Escrever `null` faria o `??` cair igual, mas quebraria os que testam
 * `if (params.x)` esperando `undefined` — e, pior, um campo com
 * `.nullable().default(null)` passaria a receber uma decisão em vez do default
 * dele. Ausência é o único valor que significa "o modelo não disse".
 *
 * ⚠️ E SÓ PARA O OPCIONAL. Num campo obrigatório — `appointment_id` — apagar a
 * chave trocaria uma recusa que ENSINA ("não encontrei esse compromisso,
 * confirme com `crm_list_appointments`") por um erro de validação de protocolo,
 * que o modelo lê pior e que não diz o que fazer em seguida. Quem decide não é
 * uma lista de nomes: é o próprio schema, perguntado se aceita a ausência.
 */
export function higienizarUuidsDeAterro(
  shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>,
  args: Record<string, unknown>,
): { limpos: Record<string, unknown>; descartados: string[] } {
  const limpos: Record<string, unknown> = { ...args };
  const descartados: string[] = [];

  for (const [campo, valor] of Object.entries(args)) {
    if (!ehUuidDeAterro(valor)) continue;
    const schemaDoCampo = shape[campo];
    // Campo que o schema não conhece: o Zod vai recusá-lo de qualquer forma.
    if (schemaDoCampo === undefined) continue;
    // A pergunta que decide, e ela é feita ao SCHEMA: este campo pode faltar?
    if (!schemaDoCampo.safeParse(undefined).success) continue;
    delete limpos[campo];
    descartados.push(campo);
  }

  return { limpos, descartados };
}
