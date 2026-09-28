/**
 * O ENDEREÇO QUE VAI DENTRO DO AVISO PRECISA ABRIR NO CELULAR DE OUTRA PESSOA.
 *
 * `NEXT_PUBLIC_APP_URL` tem default `http://localhost:3000` (`lib/env.ts`) e a
 * imagem genérica do self-host é BUILDADA com `https://placeholder.invalid`
 * (Dockerfile) — variável `NEXT_PUBLIC_` é substituída no build, não no boot.
 * As duas são endereços válidos para um `new URL()` e inúteis num WhatsApp: a
 * equipe recebe o aviso, toca no link e cai em lugar nenhum, sem erro em
 * lugar nenhum.
 *
 * A guarda existe porque o desfecho sem ela é um aviso que PARECE ter
 * funcionado. É por isso que o handler falha a entrega com
 * `sem_endereco_publico` em vez de mandar um aviso sem link.
 */
import { describe, expect, it } from "vitest";

import { linkDoCaso, urlPublicaUsavel } from "@/lib/escalacao/url-publica";

describe("urlPublicaUsavel", () => {
  it("recusa o default de desenvolvimento e o placeholder do build", () => {
    expect(urlPublicaUsavel("http://localhost:3000")).toBe(false);
    expect(urlPublicaUsavel("http://127.0.0.1:3000")).toBe(false);
    expect(urlPublicaUsavel("https://placeholder.invalid")).toBe(false);
    expect(urlPublicaUsavel("https://placeholder.invalid/app")).toBe(false);
  });

  it("recusa endereço que não é endereço", () => {
    expect(urlPublicaUsavel("")).toBe(false);
    expect(urlPublicaUsavel(null)).toBe(false);
    expect(urlPublicaUsavel("crm.exemplo.com.br")).toBe(false);
    expect(urlPublicaUsavel("ftp://crm.exemplo.com.br")).toBe(false);
  });

  it("recusa host que só existe dentro da máquina ou da rede do contêiner", () => {
    // `app` é o nome do serviço no `docker-compose.prod.yml`: ele resolve dentro
    // da rede do Docker e em lugar nenhum fora dela.
    expect(urlPublicaUsavel("http://app:3000")).toBe(false);
    expect(urlPublicaUsavel("http://192.168.0.10")).toBe(false);
    expect(urlPublicaUsavel("http://10.0.0.5:3000")).toBe(false);
  });

  it("aceita domínio real, com ou sem caminho", () => {
    expect(urlPublicaUsavel("https://crm.exemplo.com.br")).toBe(true);
    expect(urlPublicaUsavel("https://crm.exemplo.com.br/")).toBe(true);
    expect(urlPublicaUsavel("http://crm.exemplo.com.br")).toBe(true);
  });
});

describe("linkDoCaso", () => {
  it("monta o endereço do caso sem barra dupla, venha a base com ou sem barra", () => {
    const id = "0b1f7a2e-0000-4000-8000-000000000000";
    expect(linkDoCaso("https://crm.exemplo.com.br", id)).toBe(
      `https://crm.exemplo.com.br/app/ai/cases?caso=${id}`,
    );
    expect(linkDoCaso("https://crm.exemplo.com.br/", id)).toBe(
      `https://crm.exemplo.com.br/app/ai/cases?caso=${id}`,
    );
  });
});
