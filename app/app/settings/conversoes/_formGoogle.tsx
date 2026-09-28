"use client";

/**
 * O formulário da conexão com o Google Ads.
 *
 * Diferente do irmão da Meta: não há campo de token. A credencial (refresh
 * token) chega pelo botão "Conectar com Google", que manda o admin para o
 * consentimento do Google (`/api/v1/plataformas-de-anuncio/google/connect`) —
 * esta tela só grava PARA ONDE reportar depois que a autorização já existe.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateGoogleAdsConnection } from "@/app/actions/settings/updateGoogleAdsConnection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import type { EstadoDaConexaoGoogle } from "@/lib/plataformas-de-anuncio/google/estado-da-conexao";
import {
  CATEGORIAS_DE_CONVERSAO,
  type CategoriaDeConversao,
  type ModoDeValorDaVenda,
} from "@/lib/conversoes/regras-google";

import { CriarAcaoNoGoogle } from "./_criarAcaoGoogle";

const MODOS_DE_VALOR: Array<{ valor: ModoDeValorDaVenda; rotulo: string }> = [
  { valor: "quando_houver", rotulo: "Enviar a venda; o valor vai quando estiver preenchido" },
  { valor: "obrigatorio", rotulo: "Só enviar venda com valor preenchido" },
  { valor: "nunca", rotulo: "Enviar a venda sempre sem valor" },
];

const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

export function FormularioDeConversoesGoogle({
  estado,
  idioma,
  configurado,
  falta,
  dataManagerConfigurado = false,
  podeCriarAcao = false,
}: {
  estado: EstadoDaConexaoGoogle;
  /** Developer token na instalação — libera "Criar no Google". */
  podeCriarAcao?: boolean;
  idioma: Idioma;
  /** A instalação tem as três variáveis do Google Ads? Ver `config.ts`. */
  configurado: boolean;
  /** O que falta, PELO NOME — para a tela dizer em vez de só esconder o botão. */
  falta: string[];
  dataManagerConfigurado?: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState(estado.customerId ?? "");
  const [loginCustomerId, setLoginCustomerId] = useState(estado.loginCustomerId ?? "");
  const [conversionActionId, setConversionActionId] = useState(estado.conversionActionId ?? "");
  const [habilitada, setHabilitada] = useState(estado.habilitada);
  const [modoDeValor, setModoDeValor] = useState<ModoDeValorDaVenda>(
    estado.modoDeValorDaVenda ?? "obrigatorio",
  );
  const [categoriaDaVenda, setCategoriaDaVenda] = useState<CategoriaDeConversao>(
    (CATEGORIAS_DE_CONVERSAO.some((c) => c.valor === estado.categoriaDaVenda)
      ? estado.categoriaDaVenda
      : "PURCHASE") as CategoriaDeConversao,
  );
  const [enviarTelefone, setEnviarTelefone] = useState(estado.enviarTelefone ?? false);

  const api = estado.api ?? "data_manager";
  const linkDeConexao = `/api/v1/plataformas-de-anuncio/google/connect?api=${api}`;

  const podeSalvar = customerId.replace(/\D/g, "").length === 10;

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    startTransition(async () => {
      const resultado = await updateGoogleAdsConnection({
        customer_id: customerId,
        login_customer_id: loginCustomerId.trim() || null,
        conversion_action_id: conversionActionId.trim(),
        enabled: habilitada,
        purchase_value_mode: modoDeValor,
        purchase_category: categoriaDaVenda,
        send_hashed_phone: enviarTelefone,
      });

      if (resultado.ok) {
        toast.success(t("Conexão salva."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui salvar agora."));
    });
  }

  /*
   * Sem as credenciais da INSTALAÇÃO, o botão não existe — mesmo quando a
   * organização já conectou antes: sem elas o envio recusa toda venda
   * (`conversions.ts`), e mostrar o formulário diria que está tudo de pé. O
   * molde é o cartão da Agenda (`CartaoDaConexaoGoogle`): não é "você não
   * pode", é "esta instalação ainda não tem", e quem lê pode repassar o que
   * falta a quem instalou.
   */
  if (!configurado) {
    return (
      <Card className="p-6" data-testid="google-ads-nao-configurado">
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t("Google Ads")}</h3>
          {api === "google_ads" && dataManagerConfigurado && (
            <a
              className="text-sm underline"
              href="/api/v1/plataformas-de-anuncio/google/connect?api=data_manager"
            >
              {t("Autorizar nova integração do Google")}
            </a>
          )}
          <p className="text-sm text-muted-foreground">
            {t(
              "Enviar conversões para o Google Ads ainda não está disponível nesta instalação — não é nada que você tenha feito. Quem instalou o sistema precisa configurar",
            )}
            {falta.length > 0 ? (
              <>
                {" "}
                <span data-testid="google-ads-o-que-falta" className="font-mono text-xs">
                  {falta.join(` ${t("e")} `)}
                </span>
              </>
            ) : (
              ` ${t("as credenciais")}`
            )}
          </p>
        </div>
      </Card>
    );
  }

  if (!estado.temRefreshToken) {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-3">
          <h3 className="font-medium">{t("Google Ads")}</h3>
          {api === "google_ads" && dataManagerConfigurado && (
            <a
              className="text-sm underline"
              href="/api/v1/plataformas-de-anuncio/google/connect?api=data_manager"
            >
              {t("Autorizar nova integração do Google")}
            </a>
          )}
          <p className="text-sm text-muted-foreground">
            {t(
              "Autorize o acesso à conta de anúncios do Google. Depois de autorizar, você informa aqui qual conta e qual ação de conversão recebem as vendas.",
            )}
          </p>
          <a href={linkDeConexao}>
            <Button type="button">{t("Conectar com Google")}</Button>
          </a>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={salvar} className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          {t(
            api === "data_manager"
              ? "Integração atual: Data Manager. Ative a Data Manager API no projeto Google Cloud usado na autorização. A confirmação pode levar alguns minutos."
              : "Integração anterior do Google Ads. Novas contas podem precisar autorizar a Data Manager API.",
          )}
        </p>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{t("Google Ads")}</h3>
          {api === "google_ads" && dataManagerConfigurado && (
            <a
              className="text-sm underline"
              href="/api/v1/plataformas-de-anuncio/google/connect?api=data_manager"
            >
              {t("Autorizar nova integração do Google")}
            </a>
          )}
          <a href={linkDeConexao} className="text-xs underline underline-offset-2">
            {t("Reconectar")}
          </a>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="google_customer_id">{t("Conta de anúncios (Customer ID)")}</Label>
          <Input
            id="google_customer_id"
            inputMode="numeric"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="123-456-7890"
          />
          <p className="text-xs text-muted-foreground">
            {t("10 dígitos. Com ou sem hífen — tanto faz, a gente limpa.")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="google_login_customer_id">{t("Conta de gerente (opcional)")}</Label>
          <Input
            id="google_login_customer_id"
            inputMode="numeric"
            value={loginCustomerId}
            onChange={(e) => setLoginCustomerId(e.target.value)}
            placeholder="123-456-7890"
          />
          <p className="text-xs text-muted-foreground">
            {t("Preencha só se você acessa a conta acima através de uma conta MCC/gerente.")}
          </p>
        </div>

        <fieldset className="flex flex-col gap-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">{t("Venda (negócio ganho)")}</legend>
          <div className="flex flex-col gap-2">
            <Label htmlFor="google_conversion_action_id">
              {t("Ação de conversão da venda (ID)")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="google_conversion_action_id"
                inputMode="numeric"
                value={conversionActionId}
                onChange={(e) => setConversionActionId(e.target.value.replace(/\D/g, ""))}
                placeholder="123456789"
              />
              <CriarAcaoNoGoogle
                idioma={idioma}
                habilitado={podeCriarAcao && estado.temRefreshToken && Boolean(estado.customerId)}
                nome="Venda"
                categoria={categoriaDaVenda}
                incluirEmConversoes
                onCriada={(id) => setConversionActionId(id)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Recebe a compra quando o negócio é marcado como ganho. Deixe vazio se você só quer enviar etapas do funil.",
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="google_purchase_category">{t("Categoria da conversão")}</Label>
            <select
              id="google_purchase_category"
              className="rounded-md border bg-background p-2 text-sm"
              value={categoriaDaVenda}
              onChange={(e) => setCategoriaDaVenda(e.target.value as CategoriaDeConversao)}
            >
              {CATEGORIAS_DE_CONVERSAO.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {t(c.rotulo)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="google_purchase_value_mode">{t("Valor do negócio")}</Label>
            <select
              id="google_purchase_value_mode"
              className="rounded-md border bg-background p-2 text-sm"
              value={modoDeValor}
              onChange={(e) => setModoDeValor(e.target.value as ModoDeValorDaVenda)}
            >
              {MODOS_DE_VALOR.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {t(m.rotulo)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t(
                "Com o valor, o Google pode otimizar por receita e não só por volume. Venda sem valor vai sem valor — nunca como zero.",
              )}
            </p>
          </div>
        </fieldset>

        <div className="flex items-start gap-3">
          <Switch
            id="google_send_hashed_phone"
            checked={enviarTelefone}
            onCheckedChange={setEnviarTelefone}
          />
          <div>
            <Label htmlFor="google_send_hashed_phone">
              {t("Enviar o telefone do contato criptografado")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t(
                "O telefone vai em SHA-256, nunca em claro, e ajuda o Google a ligar a conversão a quem clicou no anúncio. É dado pessoal: ligue só se a sua política de privacidade cobre esse uso.",
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch id="google_enabled" checked={habilitada} onCheckedChange={setHabilitada} />
          <Label htmlFor="google_enabled">{t("Enviar conversões para o Google Ads")}</Label>
        </div>

        <Button type="submit" disabled={!podeSalvar || isPending}>
          {isPending ? t("Salvando...") : t("Salvar")}
        </Button>
      </form>
    </Card>
  );
}
