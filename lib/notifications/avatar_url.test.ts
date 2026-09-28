import { describe, expect, it } from "vitest";

import { avatarUrlServivel } from "./avatar_url";

describe("avatarUrlServivel", () => {
  it("aceita URL assinada fora da API autenticada", () => {
    expect(
      avatarUrlServivel(
        "https://store.example/object/sign/foto.jpg?token=x",
        "http://localhost:3000",
      ),
    ).toBe("https://store.example/object/sign/foto.jpg?token=x");
  });

  it("rejeita o proxy autenticado — o SO não manda cookie", () => {
    expect(
      avatarUrlServivel("http://localhost:3000/api/v1/contacts/abc/avatar", "http://localhost:3000"),
    ).toBeUndefined();
  });
});
