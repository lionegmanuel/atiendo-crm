import { afterEach, describe, expect, it, vi } from "vitest";

import { emitNotification } from "./emit";
import { NOTIFY_KINDS } from "./kinds";

describe("emitNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("não-op quando a permissão é denied", () => {
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "denied" }));
    vi.stubGlobal("window", {
      ...window,
      Notification: Object.assign(ctor, { permission: "denied" }),
      localStorage: window.localStorage,
      __PUBLIC_ENV__: { APP_NAME: "Acme" },
    });
    window.localStorage.setItem("alerts.enabled", "1");

    emitNotification({
      kind: "message_inbound",
      title: "Nova mensagem",
      body: "oi",
    });

    expect(ctor).not.toHaveBeenCalled();
  });

  it("mostra toast nativo com nome, prévia e foto", () => {
    const instances: Array<{ onclick: unknown; close: () => void }> = [];
    function Ctor(this: { onclick: unknown; close: () => void }, title: string, opts: unknown) {
      this.onclick = null;
      this.close = vi.fn();
      instances.push(this);
      Object.assign(this, { title, opts });
    }
    Ctor.permission = "granted";
    vi.stubGlobal("Notification", Ctor);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    window.localStorage.setItem("alerts.enabled", "1");
    (window as unknown as { __PUBLIC_ENV__?: { APP_NAME?: string; APP_LOGO_URL?: string } }).__PUBLIC_ENV__ =
      { APP_NAME: "Acme", APP_LOGO_URL: "" };

    emitNotification({
      kind: "message_inbound",
      title: "Maria",
      body: "texto do cliente",
      tag: "conv-1",
      href: "/app/inbox?id=conv-1",
      icon: "https://cdn.example/foto.jpg",
    });

    expect(instances).toHaveLength(1);
    expect((instances[0] as unknown as { title: string }).title).toBe("Maria");
    const opts = (
      instances[0] as unknown as {
        opts: { tag: string; body: string; icon?: string; silent: boolean; data: { href: string } };
      }
    ).opts;
    expect(opts.body).toBe("texto do cliente");
    expect(opts.tag).toBe(`${NOTIFY_KINDS.message_inbound.tagPrefix}:conv-1`);
    expect(opts.icon).toBe("https://cdn.example/foto.jpg");
    expect(opts.silent).toBe(false);
    expect(opts.data.href).toContain("/app/inbox?id=conv-1");
  });
});
