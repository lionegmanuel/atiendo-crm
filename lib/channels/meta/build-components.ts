/**
 * Contrato + valores → `components[]` do payload de envio da Meta.
 *
 * Este é o SEGUNDO consumidor de `deriveTemplateContract`, e é o que fecha o buraco:
 * o formulário da tela monta um campo por slot, este montador monta um parâmetro por
 * slot, e os dois leem a MESMA lista. Divergir deixa de ser questão de disciplina.
 * Se alguém se pegar reinterpretando `components` aqui, parou de usar a derivação.
 *
 * ─── A chave de `values` endereça o SLOT, não a `key` ───
 * Um carrossel de 2 cards tem dois slots com `key: '1'`. Chaveado só pela `key`, o
 * segundo card sobrescreve o primeiro EM SILÊNCIO — a tela mostraria um campo onde
 * existem dois, e o envio iria com metade do carrossel errado. Por isso `slotKey` é
 * exportada e é a fonte ÚNICA: a tela usa a mesma função. Chave montada de dois jeitos
 * diferentes é o mismatch voltando pela porta dos fundos.
 */
import type {
  ParamSlot,
  SlotAddress,
  SlotExpects,
  TemplateContract,
} from "./template-contract";
import { describeAddress } from "./template-contract";

/** Um parâmetro do payload. `parameter_name` só existe em template NAMED. */
export type MetaSendParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | { type: "image"; image: { link: string } }
  | { type: "video"; video: { link: string } }
  | { type: "document"; document: { link: string } }
  | { type: "coupon_code"; coupon_code: string };

export type MetaSendComponent =
  | { type: "header" | "body"; parameters: MetaSendParameter[] }
  | { type: "button"; sub_type: string; index: string; parameters: MetaSendParameter[] }
  | { type: "carousel"; cards: { card_index: number; components: MetaSendComponent[] }[] };

/**
 * O endereço do slot como chave de formulário. Corpo fica sem prefixo porque é o caso
 * comum e casa com o `{{1}}` que o operador vê no template; todo o resto é qualificado.
 * Placeholder da Meta é `\w+`, então `:` nunca aparece numa `key` — não há colisão.
 */
export function slotKey(address: SlotAddress, key: string): string {
  return addressPrefix(address) + key;
}

function addressPrefix(a: SlotAddress): string {
  switch (a.kind) {
    case "body":
      return "";
    case "header":
      return "header:";
    case "button":
      return `button${a.index}:`;
    case "card":
      return `card${a.cardIndex}:${addressPrefix(a.inner)}`;
  }
}

/** Slots do contrato que `values` não preenche. Valor em branco conta como ausente. */
export function missingSlots(
  contract: TemplateContract,
  values: Record<string, string>,
): ParamSlot[] {
  return contract.slots.filter((s) => !(values[slotKey(s.address, s.key)] ?? "").trim());
}

function parameterFor(slot: ParamSlot, value: string, named: boolean): MetaSendParameter {
  const expects: SlotExpects = slot.expects;
  switch (expects) {
    case "text":
    case "url_suffix":
      // `parameter_name` só vale para texto: mídia e cupom não o aceitam.
      return named && expects === "text"
        ? { type: "text", parameter_name: slot.key, text: value }
        : { type: "text", text: value };
    case "image":
      return { type: "image", image: { link: value } };
    case "video":
      return { type: "video", video: { link: value } };
    case "document":
      return { type: "document", document: { link: value } };
    case "coupon_code":
      return { type: "coupon_code", coupon_code: value };
    default:
      // `currency` e `date_time` são objetos estruturados no payload da Meta, não
      // string. A derivação ainda não os emite; montá-los como texto produziria
      // 132012. Falhar aqui avisa quem estender a derivação que este lado precisa
      // acompanhar — silêncio deixaria o defeito sair pelo fio.
      throw new Error(
        `buildComponents: slot ${describeAddress(slot.address)} espera '${expects}', ` +
          `que este montador ainda não sabe montar`,
      );
  }
}

/** Agrupa os slots de UM nível (fora de card, ou dentro de um card) em componentes. */
function componentsForLeafSlots(
  slots: ParamSlot[],
  values: Record<string, string>,
  named: boolean,
): MetaSendComponent[] {
  const header: MetaSendParameter[] = [];
  const body: MetaSendParameter[] = [];
  const buttons = new Map<number, { subType: string; parameters: MetaSendParameter[] }>();

  for (const slot of slots) {
    const address = slot.address.kind === "card" ? slot.address.inner : slot.address;
    const param = parameterFor(slot, values[slotKey(slot.address, slot.key)]!, named);
    if (address.kind === "header") header.push(param);
    else if (address.kind === "body") body.push(param);
    else {
      const entry = buttons.get(address.index) ?? { subType: address.subType, parameters: [] };
      entry.parameters.push(param);
      buttons.set(address.index, entry);
    }
  }

  const out: MetaSendComponent[] = [];
  if (header.length > 0) out.push({ type: "header", parameters: header });
  if (body.length > 0) out.push({ type: "body", parameters: body });
  for (const [index, { subType, parameters }] of [...buttons.entries()].sort((a, b) => a[0] - b[0]))
    out.push({ type: "button", sub_type: subType, index: String(index), parameters });
  return out;
}

/**
 * @throws se algum slot do contrato ficou sem valor. Montar o payload incompleto e
 *   deixar a Meta reprovar com 132000 é o comportamento de hoje; falhar aqui põe o
 *   erro onde o operador ainda pode corrigi-lo. Chame `missingSlots` antes para
 *   perguntar sem provocar exceção.
 */
export function buildComponents(
  contract: TemplateContract,
  values: Record<string, string>,
): MetaSendComponent[] {
  const faltando = missingSlots(contract, values);
  if (faltando.length > 0) {
    throw new Error(
      `buildComponents: ${faltando.length} parâmetro(s) sem valor — ` +
        faltando.map((s) => `${describeAddress(s.address)} {{${s.key}}}`).join(", "),
    );
  }

  const named = contract.parameterFormat === "NAMED";
  const planos = contract.slots.filter((s) => s.address.kind !== "card");
  const out = componentsForLeafSlots(planos, values, named);

  // Carrossel é o único ramo que aninha: cada card repete a estrutura folha com
  // `card_index` próprio. Uma lista plana perderia essa dimensão — e é exatamente
  // por isso que o endereço do slot é recursivo.
  const porCard = new Map<number, ParamSlot[]>();
  for (const slot of contract.slots) {
    if (slot.address.kind !== "card") continue;
    const lista = porCard.get(slot.address.cardIndex) ?? [];
    lista.push(slot);
    porCard.set(slot.address.cardIndex, lista);
  }
  if (porCard.size > 0) {
    out.push({
      type: "carousel",
      cards: [...porCard.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([card_index, slots]) => ({
          card_index,
          components: componentsForLeafSlots(slots, values, named),
        })),
    });
  }

  return out;
}
