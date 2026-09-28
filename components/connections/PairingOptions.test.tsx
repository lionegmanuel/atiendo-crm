import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { PairingOptions } from "./PairingOptions";
const h = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: h.post } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.post.mockResolvedValue({ data: { code: "ABCD-1234" } });
});
it("keeps QR available and only generates a code after an explicit request", async () => {
  render(<PairingOptions sessionId="channel" qr={<div>QR existente</div>} />);
  expect(screen.getByText("QR existente")).toBeTruthy();
  expect(h.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conectar por código" }));
  fireEvent.change(screen.getByLabelText("Telefone com código do país e DDD"), {
    target: { value: "+55 11 99999-1234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gerar código" }));
  await screen.findByText("ABCD-1234");
  expect(h.post).toHaveBeenCalledWith(
    "/api/v1/channel-sessions/channel/pairing-code",
    { phone_number: "+55 11 99999-1234" },
    expect.anything(),
  );
  expect(screen.queryByText("Conectado!")).toBeNull();
  expect((screen.getByRole("button", { name: "Aguarde 30s" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
  expect(screen.getByText("QR existente")).toBeTruthy();
  expect(screen.queryByText("ABCD-1234")).toBeNull();
});
it("shows a failure and allows returning to QR without generating another code", async () => {
  h.post.mockRejectedValue(new Error("transport"));
  render(<PairingOptions sessionId="channel" qr={<div>QR existente</div>} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar por código" }));
  fireEvent.change(screen.getByLabelText("Telefone com código do país e DDD"), {
    target: { value: "5511999991234" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gerar código" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Não foi possível"));
  fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
  expect(screen.getByText("QR existente")).toBeTruthy();
  expect(h.post).toHaveBeenCalledTimes(1);
});
