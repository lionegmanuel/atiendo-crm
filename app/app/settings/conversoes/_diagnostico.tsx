/**
 * Aba "Diagnóstico" de Configurações › Conversões (0436): a saúde da
 * integração com o Google Ads em cinco cartões, cada um com o próximo passo.
 */
import type { ItemDoDiagnostico, Saude } from "@/lib/conversoes/historico";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const ESTILO: Record<Saude, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10",
  atencao: "border-amber-500/40 bg-amber-500/10",
  problema: "border-destructive/40 bg-destructive/10",
};

const ROTULO: Record<Saude, string> = { ok: "OK", atencao: "Atenção", problema: "Problema" };

export function DiagnosticoGoogle({
  itens,
  idioma,
}: {
  itens: ItemDoDiagnostico[];
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <section className="flex flex-col gap-3" data-testid="diagnostico-google">
      <h2 className="text-lg font-semibold">{t("Saúde da integração com o Google Ads")}</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {itens.map((item) => (
          <li
            key={item.chave}
            data-saude={item.saude}
            className={`flex flex-col gap-1 rounded-md border p-4 ${ESTILO[item.saude]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{t(item.titulo)}</p>
              <span className="text-xs">{t(ROTULO[item.saude])}</span>
            </div>
            <p className="text-sm text-muted-foreground">{t(item.detalhe)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
