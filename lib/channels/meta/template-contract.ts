/**
 * Derivação do CONTRATO DE PARÂMETROS de um template da Meta (spike da Fase 3a).
 *
 * A razão de existir, em uma frase: "number of parameters does not match" acontece
 * porque a definição do template vive na Meta e alguém REDIGITA quantos parâmetros ela
 * tem do lado de cá. Duas declarações do mesmo fato divergem — é só questão de tempo.
 * Aqui o contrato é **derivado**, nunca redigitado (doutrina `restricao-de-canal.md`,
 * seção "Contrato de parâmetros").
 *
 * Esta função é PURA e tem DOIS consumidores, e é isso que fecha o buraco:
 *   1. o formulário da tela — um campo por slot, rotulado pelo texto ao redor;
 *   2. o montador do payload de envio — os mesmos slots viram `components[]`.
 * Mesma derivação nos dois lados ⇒ divergir vira impossível por construção, não por
 * disciplina.
 *
 * O endereço do slot é RECURSIVO porque carrossel aninha: o payload de envio tem
 * `{type:'carousel', cards:[{card_index, components:[...]}]}`, e cada card carrega
 * seus próprios header/body/buttons com índices próprios. Uma lista plana não
 * expressa isso — e contrato que não expressa gera formulário incompleto, que é
 * exatamente o defeito original com outra roupa.
 *
 * ─── Os dois erros que esta derivação existe para tornar inalcançáveis ───
 * Medidos contra a Graph API real (WABA de teste, 2026-07-28), não deduzidos:
 *
 *   132000  "Number of parameters does not match the expected number of params"
 *           detalhe: `body: number of localizable_params (2) does not match (3)`
 *           → CONTAGEM. É o erro que sangra no TomikCRM.
 *
 *   132012  "Parameter format does not match format in the created template"
 *           detalhe: `header: Format mismatch, expected IMAGE, received UNKNOWN`
 *           → FORMATO. Dispara quando o template tem header de mídia e o envio
 *             não manda o parâmetro de header.
 *
 * O ponto que justifica o desenho inteiro: **contar `{{n}}` só previne o 132000.**
 * É cego ao 132012, porque um header `format: IMAGE` não tem placeholder nenhum
 * para contar — ele é slot pelo FORMATO. Derivar de texto E de formato previne
 * os dois; contar placeholder previne metade e dá a sensação de estar coberto.
 */

export type ButtonSubType = "url" | "copy_code" | "quick_reply";

/** Tipo de valor que o slot espera — decide o widget na tela e o `type` no payload. */
export type SlotExpects =
  | "text"
  | "currency"
  | "date_time"
  | "image"
  | "video"
  | "document"
  | "url_suffix"
  | "coupon_code";

/** Endereço do slot dentro de `components[]`. `card` é o único ramo que aninha. */
export type SlotAddress =
  | { kind: "header" }
  | { kind: "body" }
  | { kind: "button"; subType: ButtonSubType; index: number }
  | { kind: "card"; cardIndex: number; inner: LeafAddress };

export type LeafAddress = Exclude<SlotAddress, { kind: "card" }>;

export interface ParamSlot {
  address: SlotAddress;
  /** '1'|'2' (posicional) ou 'customer_name' (nomeado) — a Meta aceita os dois. */
  key: string;
  expects: SlotExpects;
  /** Texto imediatamente antes/depois do placeholder — é o rótulo do campo na tela.
   *  Sem isto o formulário mostraria "Parâmetro 1", que não ajuda ninguém a preencher.
   *  Vazio quando o slot é de mídia (não há texto ao redor). */
  contextBefore: string;
  contextAfter: string;
}

/**
 * `POSITIONAL` = `{{1}}`; `NAMED` = `{{customer_name}}`. Vem da própria Meta
 * (campo `parameter_format` do template) e **muda o payload de envio**:
 * posicional manda `{type:'text', text:'…'}`; nomeado exige
 * `{type:'text', parameter_name:'customer_name', text:'…'}`. Deduzir isto do
 * formato da chave seria adivinhação — a Meta declara, então a gente lê.
 */
export type ParameterFormat = "POSITIONAL" | "NAMED";

export interface TemplateContract {
  name: string;
  language: string;
  parameterFormat: ParameterFormat;
  slots: ParamSlot[];
}

interface MetaButton {
  type?: string;
  text?: string;
  url?: string;
}
interface MetaComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: MetaButton[];
  cards?: { components?: MetaComponent[] }[];
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const CONTEXT_CHARS = 40;

/** Extrai os placeholders de um texto, com o contexto que vira rótulo na tela. */
function slotsFromText(text: string, address: LeafAddress, expects: SlotExpects): ParamSlot[] {
  const out: ParamSlot[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    out.push({
      address,
      key: m[1]!,
      expects,
      contextBefore: text.slice(Math.max(0, at - CONTEXT_CHARS), at).replace(/\s+/g, " ").trimStart(),
      contextAfter: text
        .slice(at + m[0].length, at + m[0].length + CONTEXT_CHARS)
        .replace(/\s+/g, " ")
        .trimEnd(),
    });
  }
  return out;
}

const MEDIA_FORMAT: Record<string, SlotExpects> = {
  IMAGE: "image",
  VIDEO: "video",
  DOCUMENT: "document",
};

function buttonSubType(b: MetaButton): ButtonSubType | null {
  const t = (b.type ?? "").toUpperCase();
  if (t === "URL") return "url";
  if (t === "COPY_CODE") return "copy_code";
  return null; // QUICK_REPLY e PHONE_NUMBER não levam parâmetro
}

/** Slots de UM nível (header/body/buttons) — reusado dentro e fora de card. */
function slotsFromLeafComponents(
  components: MetaComponent[],
  wrap: (leaf: LeafAddress) => SlotAddress,
): ParamSlot[] {
  const out: ParamSlot[] = [];

  for (const c of components) {
    const type = (c.type ?? "").toUpperCase();

    if (type === "HEADER") {
      const media = MEDIA_FORMAT[(c.format ?? "").toUpperCase()];
      if (media) {
        // Header de mídia é UM slot inteiro, sem {{n}} no texto — quem esquece
        // disto monta `components[]` sem o header e leva erro da Meta.
        out.push({
          address: wrap({ kind: "header" }),
          key: "1",
          expects: media,
          contextBefore: "",
          contextAfter: "",
        });
      } else if (c.text) {
        out.push(...slotsFromText(c.text, { kind: "header" }, "text").map((s) => ({ ...s, address: wrap(s.address as LeafAddress) })));
      }
      continue;
    }

    if (type === "BODY" && c.text) {
      out.push(...slotsFromText(c.text, { kind: "body" }, "text").map((s) => ({ ...s, address: wrap(s.address as LeafAddress) })));
      continue;
    }

    if (type === "BUTTONS") {
      (c.buttons ?? []).forEach((b, index) => {
        const subType = buttonSubType(b);
        if (!subType) return;
        if (subType === "copy_code") {
          out.push({
            address: wrap({ kind: "button", subType, index }),
            key: "1",
            expects: "coupon_code",
            contextBefore: b.text ?? "",
            contextAfter: "",
          });
          return;
        }
        // Botão URL só leva parâmetro se a url tem placeholder (sufixo dinâmico).
        for (const s of slotsFromText(b.url ?? "", { kind: "button", subType, index }, "url_suffix")) {
          out.push({ ...s, address: wrap(s.address as LeafAddress) });
        }
      });
    }
    // FOOTER nunca aceita parâmetro.
  }

  return out;
}

export function deriveTemplateContract(t: {
  name: string;
  language: string;
  parameter_format?: string;
  components?: MetaComponent[];
}): TemplateContract {
  const components = t.components ?? [];
  const slots: ParamSlot[] = slotsFromLeafComponents(components, (leaf) => leaf);

  // Carrossel: cada card repete a estrutura folha, com card_index próprio.
  for (const c of components) {
    if ((c.type ?? "").toUpperCase() !== "CAROUSEL") continue;
    (c.cards ?? []).forEach((card, cardIndex) => {
      slots.push(
        ...slotsFromLeafComponents(card.components ?? [], (leaf) => ({
          kind: "card",
          cardIndex,
          inner: leaf,
        })),
      );
    });
  }

  return {
    name: t.name,
    language: t.language,
    // Default POSITIONAL: é o que a Meta assume quando o campo não vem, e é o
    // formato de todo template legado. Nunca inferir da CHAVE ('1' vs 'nome') —
    // um template NAMED com chave numérica existe e seria classificado errado.
    parameterFormat: t.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL",
    slots,
  };
}

/** Rótulo humano de um endereço — usado na tela e nas mensagens de erro. */
export function describeAddress(a: SlotAddress): string {
  switch (a.kind) {
    case "header":
      return "cabeçalho";
    case "body":
      return "corpo";
    case "button":
      return `botão ${a.index + 1} (${a.subType})`;
    case "card":
      return `card ${a.cardIndex + 1} › ${describeAddress(a.inner)}`;
  }
}
