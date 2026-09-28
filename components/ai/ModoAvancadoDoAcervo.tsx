"use client";

import { useT } from "@/hooks/i18n/useT";

/**
 * O acervo é o modo AVANÇADO, e opcional: o agente atende sem ele, com o
 * catálogo colado nas próprias instruções. Esta caixa diz isso antes de
 * qualquer upload, e diz o que precisa estar ligado na OpenAI — sem isso, o
 * primeiro material "não entra" e a tela parecia quebrada.
 */
export function ModoAvancadoDoAcervo() {
  const t = useT();
  return (
    <details
      className="rounded-md border border-border bg-surface p-4 text-sm"
      data-testid="acervo-modo-avancado"
    >
      <summary className="cursor-pointer font-medium">
        {t("Modo avançado (opcional): anexar arquivos para o agente consultar")}
      </summary>
      <div className="mt-3 space-y-3 text-text-muted">
        <p>
          {t(
            "O agente funciona sem esta tela: você pode colar o catálogo, os preços e as perguntas frequentes direto nas instruções dele, em Agentes.",
          )}
        </p>
        <p>
          {t(
            "Aqui você anexa arquivos (PDF, Markdown, CSV ou texto) e o agente consulta só o trecho de que precisa. Para isso, a sua chave da OpenAI precisa ter acesso aos modelos de embeddings.",
          )}
        </p>
        <div>
          <p className="font-medium text-text">{t("Como ativar na OpenAI")}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>{t("Entre em platform.openai.com › Settings › Project › Limits.")}</li>
            <li>
              {t("Em Model usage, permita o modelo text-embedding-3-small (ou libere todos os modelos).")}
            </li>
            <li>
              {t("Se a sua chave for restrita (Restricted), dê a ela permissão de uso de modelos em API keys.")}
            </li>
            <li>{t("Volte aqui, adicione o material e, se ele já estava na lista, clique em “Preparar de novo”.")}</li>
          </ol>
        </div>
      </div>
    </details>
  );
}
