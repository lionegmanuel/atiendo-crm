/**
 * O CONTRATO DE PRESENÇA, PROVADO CONTRA UM RECEIVER DE VERDADE.
 *
 * Mock não serve aqui: o que este teste precisa afirmar é o formato EXATO do
 * pedido que sai pela rede (método, caminho, cabeçalho, corpo). Um dublê que
 * devolve `{ok:true}` fica verde com o caminho errado, o verbo errado e o corpo
 * errado — e a falha só apareceria na VPS do cliente, como um "digitando…" que
 * nunca acende e que ninguém liga a este código, porque a chamada falha macio.
 *
 * Contrato de origem (docs do WAHA, seção Presence):
 *   POST /api/{session}/presence   body: { chatId, presence }
 *   presence ∈ online | offline | typing | recording | paused
 *   `typing` e `paused` exigem `chatId`; `online`/`offline` não o levam.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WahaClient } from "./client";

interface PedidoRecebido {
  method: string;
  url: string;
  apiKey: string | undefined;
  body: unknown;
}

let receiver: Server;
let urlBase = "";
let recebidos: PedidoRecebido[] = [];
/** Status que o receiver devolve — trocado por teste. */
let statusDaVez = 200;

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const cru = Buffer.concat(chunks).toString("utf8");
      recebidos.push({
        method: req.method ?? "",
        url: req.url ?? "",
        apiKey: req.headers["x-api-key"] as string | undefined,
        body: cru === "" ? null : JSON.parse(cru),
      });
      res.writeHead(statusDaVez, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: statusDaVez < 300 }));
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  urlBase = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => receiver.close(() => r()));
});

function limpar(): void {
  recebidos = [];
  statusDaVez = 200;
}

describe("WahaClient.setPresence", () => {
  it("POSTa em /api/{session}/presence com chatId + presence, e a chave no header", async () => {
    limpar();
    const client = new WahaClient(urlBase, "chave-hash-sha512");

    await client.setPresence("sessao-do-tenant", "5527999998888@c.us", "typing");

    expect(recebidos).toHaveLength(1);
    const p = recebidos[0]!;
    expect(p.method).toBe("POST");
    // A sessão vai no CAMINHO, não no corpo — é o que a doc do WAHA especifica
    // para presença (ao contrário de /api/sendText, que a leva no corpo).
    expect(p.url).toBe("/api/sessao-do-tenant/presence");
    expect(p.body).toEqual({ chatId: "5527999998888@c.us", presence: "typing" });
    // Chave NUNCA em query string (CLAUDE.md) — sempre header.
    expect(p.apiKey).toBe("chave-hash-sha512");
    expect(p.url).not.toContain("chave-hash-sha512");
  });

  it("escapa o nome da sessão no caminho", async () => {
    limpar();
    const client = new WahaClient(urlBase, "k");
    await client.setPresence("sessão com espaço", "1@c.us", "paused");
    expect(recebidos[0]!.url).toBe("/api/sess%C3%A3o%20com%20espa%C3%A7o/presence");
  });

  it("status de erro vira throw `waha_<status>` — quem chama decide falhar macio", async () => {
    limpar();
    statusDaVez = 422;
    const client = new WahaClient(urlBase, "k");

    // Lança, e o CORPO da resposta não entra na mensagem (doutrina do
    // cabeçalho de client.ts: resposta de terceiro não atravessa nossa borda).
    await expect(client.setPresence("s", "1@c.us", "typing")).rejects.toThrow("waha_422");
  });
});
