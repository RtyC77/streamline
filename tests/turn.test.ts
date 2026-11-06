import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTurn } from "../supabase/functions/turn-credentials/index";
const origin = "https://streamlite.example";
const user = crypto.randomUUID();
const env = {
  get: (name: string) =>
    (
      ({
        ALLOWED_ORIGINS: origin,
        SUPABASE_URL: "https://example.supabase.co",
        PUBLIC_SUPABASE_KEY: "public",
        TURN_SHARED_SECRET: "test-secret",
        TURN_URLS: "turn:example.com:3478",
      }) as Record<string, string>
    )[name],
};
const req = (
  body: object = {},
  authorization = "Bearer signed-user-token",
  site = origin,
) =>
  new Request(origin, {
    method: "POST",
    headers: {
      origin: site,
      authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllGlobals());
describe("Emissão de TURN temporário", () => {
  it("recusa origem e autenticação ausente antes de emitir credenciais", async () => {
    expect(
      (await handleTurn(req({}, "", "https://evil.example"), env)).status,
    ).toBe(403);
    expect((await handleTurn(req({}, ""), env)).status).toBe(401);
  });
  it("recusa usuário não membro", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: user }))
        .mockResolvedValueOnce(Response.json(false)),
    );
    expect(
      (await handleTurn(req({ roomId: crypto.randomUUID() }), env)).status,
    ).toBe(403);
  });
  it("emite HMAC apenas após validar JWT e associação no servidor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: user }))
      .mockResolvedValueOnce(Response.json(true));
    vi.stubGlobal("fetch", fetcher);
    const response = await handleTurn(
      req({ roomId: crypto.randomUUID() }),
      env,
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.iceServers[0].username).toContain(user);
    expect(data.iceServers[0].credential).toMatch(/^[a-zA-Z0-9+/]+=*$/);
    expect(data.expiresAt).toBeGreaterThan(Date.now() / 1000 + 3500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(data)).not.toContain("test-secret");
  });
  it("não emite credenciais quando o Auth rejeita o JWT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    expect(
      (await handleTurn(req({ roomId: crypto.randomUUID() }), env)).status,
    ).toBe(401);
  });
});
