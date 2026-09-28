/**
 * POST /api/v1/tenants/provision — um sistema externo cria (ou reencontra,
 * idempotente por integração + id externo) uma organização e recebe uma chave
 * de API `dsk_…` para operá-la.
 *
 * Decisão do dono (doc 38, opção b): a porta existe, mas a chave é do DONO DA
 * INSTALAÇÃO — `TENANT_PROVISIONING_SECRET` no `.env`, nunca uma chave de
 * organização — e nasce DESLIGADA. Sem o segredo (ou com um curto demais), a
 * rota responde 404: para quem não ligou, ela não existe. É uma segunda porta
 * de cadastro que não passa pela chave de cadastro da instalação, então só quem
 * já manda na instalação pode abri-la.
 *
 * O `organization_id` não vem do cliente em momento nenhum: ele nasce aqui, ou é
 * reencontrado pelo marcador que o próprio provisionamento gravou.
 *
 * A chave devolvida tem `mcp:read`/`mcp:write` e papel `agent` — abre as
 * ferramentas e rotas de atendente, não as de `ai_operator`/`manager` (ver
 * `lib/tenants/api-key.ts`). E não há teto de organizações por instalação:
 * quem tem o segredo cria quantas quiser, variando `external_id`. É por isso
 * que o segredo é do dono da instalação e a rota nasce desligada.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { checkRateLimit, peekRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import {
  EmailJaTemContaError,
  ProvisionConflictError,
  provisionExternalTenant,
} from "@/lib/auth/provision";
import { env } from "@/lib/env";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { logger } from "@/lib/logger";
import { extractBearer } from "@/lib/mcp/auth";
import { provisionTenantSchema, type ProvisionTenantInput } from "@/lib/schemas/tenant-provisioning";
import { validateRequest } from "@/lib/schemas/_validate";
import { rotateIntegrationApiKey } from "@/lib/tenants/api-key";

export const dynamic = "force-dynamic";

/** Abaixo disto o segredo é adivinhável, e a rota fica desligada. */
const TAMANHO_MINIMO_DO_SEGREDO = 32;
/** FALHAS por IP por minuto — acima disto é varredura de segredo, não integração. */
const FALHAS_POR_MINUTO = 10;

function segredoDaInstalacao(): string | null {
  const segredo = env.TENANT_PROVISIONING_SECRET.trim();
  return segredo.length >= TAMANHO_MINIMO_DO_SEGREDO ? segredo : null;
}

/**
 * Comparação em tempo constante; tamanhos diferentes nunca autenticam.
 *
 * O extrator é o canônico do repo (`/^Bearer\s+(.+)$/i`), e não um
 * `startsWith("Bearer ")` próprio: este é sensível a maiúscula e a exatamente
 * um espaço, e um parceiro que mandasse `bearer <segredo>` levaria 401 aqui e
 * 200 em qualquer outra rota com bearer.
 */
function bearerConfere(req: NextRequest, esperado: string): boolean {
  const recebido = extractBearer(req.headers.get("authorization")) ?? "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const esperado = segredoDaInstalacao();
  if (!esperado) return fail("not_found", "Not found.", 404, { requestId });

  // O limite existe para quem tenta ADIVINHAR o segredo, então ele conta
  // FALHAS, não chamadas: a integração legítima acerta e nunca esbarra nele.
  //
  // Sem IP não há balde por IP — e isto é decisão de segurança, a mesma de
  // `lib/auth/rate-limit.ts:88`. Um sentinela `"desconhecido"` jogaria todo
  // mundo num balde só, e o kit self-host expõe o app sem proxy, então
  // `x-forwarded-for` ausente é o caminho NORMAL: o atacante dividiria o balde
  // com a integração e derrubaria a rota da instalação inteira. O balde por IP
  // é isolamento, nunca prova de origem: forjar o header só troca de balde.
  const ip = ipDoCliente(req.headers);
  const balde = ip === null ? null : `tenants_provision:falha:ip:${ip}`;
  const falhas = balde === null ? 0 : await peekRateLimit(balde, 60);
  // Tipado como mapa de strings de propósito: o ternário devolveria a UNIÃO
  // `{} | {…}`, e sob `exactOptionalPropertyTypes` a união espalhada carrega as
  // chaves como `?: undefined` — que não é `HeadersInit`. O tipo explícito é o
  // que existe de menos invasivo aqui; alargar `HeadersInit` seria o contrário.
  const cabecalhosDoLimite: Record<string, string> =
    balde === null
      ? {}
      : {
          "X-RateLimit-Limit": String(FALHAS_POR_MINUTO),
          "X-RateLimit-Remaining": String(Math.max(0, FALHAS_POR_MINUTO - falhas)),
        };
  if (balde !== null && falhas >= FALHAS_POR_MINUTO) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { ...cabecalhosDoLimite, "Retry-After": "60" },
    });
  }

  if (!bearerConfere(req, esperado)) {
    if (balde !== null) await checkRateLimit(balde, FALHAS_POR_MINUTO, 60);
    return fail("unauthenticated", "Credencial inválida.", 401, {
      requestId,
      headers: cabecalhosDoLimite,
    });
  }

  let input: ProvisionTenantInput;
  try {
    input = await validateRequest(provisionTenantSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  try {
    const { organizationId, ownerId, replay } = await provisionExternalTenant({
      integration: input.integration,
      externalId: input.external_id,
      organizationName: input.organization_name,
      ownerEmail: input.owner_email,
      ownerName: input.owner_name,
      requestId,
    });

    const apiKey = await rotateIntegrationApiKey({
      organizationId,
      createdBy: ownerId,
      integrationScope: `integration:${input.integration}`,
      name: `${input.integration} (integração)`,
      requestId,
    });

    return ok(
      { organization_id: organizationId, api_key: apiKey, replay },
      {
        status: replay ? 200 : 201,
        requestId,
        // A resposta carrega a chave em texto, uma vez só: nenhum cache guarda.
        headers: { ...cabecalhosDoLimite, "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    if (err instanceof EmailJaTemContaError) {
      return fail(
        "owner_email_ja_tem_conta",
        "Esse e-mail já tem conta nesta instalação — convide a pessoa pela tela da empresa.",
        409,
        { requestId },
      );
    }
    if (err instanceof ProvisionConflictError) {
      return fail(
        "provisioning_conflict",
        "Já existe uma organização com este identificador que não nasceu deste provisionamento.",
        409,
        { requestId },
      );
    }
    logger.error("[tenants.provision] falhou", {
      requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não foi possível provisionar a organização.", 500, { requestId });
  }
}
