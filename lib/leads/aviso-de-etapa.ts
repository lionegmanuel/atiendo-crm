/**
 * O texto do aviso de etapa (`crm_stages.avisar_na_central`, migration 0440).
 *
 * Módulo PURO, sem banco — roda no servidor e no navegador: quem escreve o
 * aviso (`./aviso-de-etapa.handler.ts`) monta o título por aqui, e é por este
 * mesmo título que o handler reconhece um aviso já aberto e que o som da
 * Central (`lib/notifications/sons-da-org.ts`) reconhece o aviso de etapa. As
 * pontas não podem divergir.
 *
 * O título diz só a ETAPA, entre aspas angulares: o título do negócio costuma
 * ser o nome ou o telefone do cliente, e a Central mostra o texto como foi
 * gravado. Quem abre o aviso vê o negócio com a permissão que tem.
 */
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMAS, type Idioma } from "@/lib/i18n/idiomas";

/** A chave do dicionário do começo do título. */
const INICIO_DO_TITULO = "Negócio entrou em";

export function tituloDoAvisoDeEtapa(etapa: string, idioma: Idioma): string {
  return `${traduzir(INICIO_DO_TITULO, idioma)} «${etapa}»`;
}

export function corpoDoAvisoDeEtapa(idioma: Idioma): string {
  return traduzir(
    "Abra o negócio para dar o próximo passo. Este aviso foi pedido na configuração da etapa.",
    idioma,
  );
}

/**
 * É o aviso de etapa? Pelo KIND, pela REFERÊNCIA e pelo COMEÇO do título.
 *
 * ⚠️ `kind = 'other'` com `ref_kind = 'lead'` NÃO basta, e a primeira versão
 * desta regra caía exatamente aí: o espelho de etapa que o assistente não
 * conseguiu gravar (`abreAvisoDoEspelhoRecusado`, em
 * `lib/agent-engine/edge/crm/move-lead-stage.ts`) também nasce `other`
 * apontando para um negócio — e um defeito de funil tocaria o som de "entrou
 * na etapa". O aviso não tem coluna de origem; o título, montado por
 * `tituloDoAvisoDeEtapa`, é a marca. Confere em TODO idioma servido: a
 * organização pode ter mudado de idioma depois de o aviso nascer.
 */
export function ehAvisoDeEtapa(aviso: {
  kind: string;
  ref_kind: string | null;
  title?: string | null;
}): boolean {
  if (aviso.kind !== "other" || aviso.ref_kind !== "lead") return false;
  const titulo = aviso.title ?? "";
  return IDIOMAS.some((idioma) => titulo.startsWith(`${traduzir(INICIO_DO_TITULO, idioma)} «`));
}
