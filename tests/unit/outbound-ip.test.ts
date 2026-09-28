import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertDestinoResolvidoSeguro, ipEhEspecial } from "@/lib/automation/outbound-ip";

// Hoisted: o módulo sob teste importa `lookup` no topo, então doMock + import
// dinâmico chegaria tarde demais. A resposta do DNS é controlada por variável.
const dns = vi.hoisted(() => ({
  resposta: [] as Array<{ address: string; family: number }>,
  erro: null as Error | null,
}));
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async () => {
    if (dns.erro) throw dns.erro;
    return dns.resposta;
  });
  // O `default` é obrigatório: algum módulo da árvore importa `dns/promises`
  // como default, e sem ele o vitest recusa o mock na COLETA — o arquivo
  // inteiro vira "no tests", que é indistinguível de suíte vazia.
  return { lookup, default: { lookup } };
});

beforeEach(() => {
  dns.resposta = [];
  dns.erro = null;
});

/**
 * Anti-SSRF por IP resolvido (relatório de segurança da comunidade).
 *
 * O guard anterior lia o TEXTO do hostname; um domínio do atacante que resolve
 * para IP privado passava. Aqui se mede o julgamento do IP e a resolução.
 */
describe("ipEhEspecial — faixas que um webhook nunca deve alcançar", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback fora do .1", "127.99.88.77"],
    ["privada 10/8", "10.1.2.3"],
    ["privada 192.168/16", "192.168.0.10"],
    ["privada 172.16/12 (rede do Docker)", "172.17.0.2"],
    ["limite superior da 172.16/12", "172.31.255.254"],
    ["metadata de nuvem", "169.254.169.254"],
    ["CGNAT 100.64/10", "100.64.1.1"],
    ["este host", "0.0.0.0"],
    ["broadcast", "255.255.255.255"],
    ["multicast", "224.0.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 não especificado", "::"],
    ["IPv6 ULA", "fc00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4-mapped escondendo loopback", "::ffff:127.0.0.1"],
    ["NAT64 (alcança IPv4 privado)", "64:ff9b::a00:1"],
    ["lixo", "não-é-ip"],
  ])("recusa %s", (_rotulo, ip) => {
    expect(ipEhEspecial(ip)).toBe(true);
  });

  it.each([
    ["IPv4 público", "8.8.8.8"],
    ["IPv4 público 2", "93.184.216.34"],
    ["logo ABAIXO da 172.16/12", "172.15.255.255"],
    ["logo ACIMA da 172.16/12", "172.32.0.1"],
    ["logo abaixo da 100.64/10", "100.63.255.255"],
    ["IPv6 público", "2606:4700:4700::1111"],
  ])("aceita %s", (_rotulo, ip) => {
    // Controle positivo: sem estes, uma função que devolvesse `true` sempre
    // passaria na metade de cima desta suíte.
    expect(ipEhEspecial(ip)).toBe(false);
  });
});

describe("assertDestinoResolvidoSeguro — resolve antes de julgar", () => {
  it("literal privado é recusado sem consultar DNS", async () => {
    await expect(assertDestinoResolvidoSeguro("127.0.0.1")).rejects.toThrow("unsafe_url:private_ip");
  });

  it("literal público passa", async () => {
    await expect(assertDestinoResolvidoSeguro("8.8.8.8")).resolves.toBeUndefined();
  });

  it("hostname que resolve para IP privado é recusado (o rebinding)", async () => {
    dns.resposta = [{ address: "169.254.169.254", family: 4 }];
    await expect(assertDestinoResolvidoSeguro("metadata.atacante.example")).rejects.toThrow(
      "unsafe_url:private_ip",
    );
  });

  it("um endereço público E um privado na MESMA resposta é recusado", () => {
    // A assinatura do rebinding. Não dá para saber qual deles o fetch escolhe.
    dns.resposta = [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    return expect(assertDestinoResolvidoSeguro("dois-registros.example")).rejects.toThrow(
      "unsafe_url:private_ip",
    );
  });

  it("CONTROLE POSITIVO: hostname que resolve só para público passa", async () => {
    dns.resposta = [{ address: "93.184.216.34", family: 4 }];
    await expect(assertDestinoResolvidoSeguro("legitimo.example")).resolves.toBeUndefined();
  });

  it("DNS que falha recusa (falhar fechado custa uma entrega; aberto custa a rede interna)", async () => {
    dns.erro = new Error("ENOTFOUND");
    await expect(assertDestinoResolvidoSeguro("nao-existe.example")).rejects.toThrow(
      "unsafe_url:dns_failed",
    );
  });

  it("resposta VAZIA do DNS também recusa", async () => {
    dns.resposta = [];
    await expect(assertDestinoResolvidoSeguro("vazio.example")).rejects.toThrow(
      "unsafe_url:dns_empty",
    );
  });
});
