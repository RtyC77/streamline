import { describe, expect, it, vi } from "vitest";
import { registerAccount } from "../supabase/functions/register-account/index";

const origin = "https://streamlite.example";
const env = new Map([
  ["REGISTRATION_ORIGINS", origin],
  ["REGISTRATION_TURNSTILE_SECRET", "test-secret"],
  ["SUPABASE_URL", "https://test.supabase.co"],
  ["SUPABASE_SERVICE_ROLE_KEY", "test-service-role"],
]);
const request = () => new Request(`${origin}/register`, {
  method: "POST",
  headers: { Origin: origin },
  body: JSON.stringify({ email: "user@example.com", username: "Player", password: "test-pass", captcha: "token" }),
});

describe("cadastro independente do envio", () => {
  it.each([200, 429])("cria a conta pendente antes de solicitar o e-mail (HTTP %i)", async (mailStatus) => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, hostname: "streamlite.example" }))
      .mockResolvedValueOnce(Response.json({}, { status: 201 }))
      .mockResolvedValueOnce(Response.json({}, { status: mailStatus }));
    const result = await registerAccount(request(), env, send);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ confirmation: mailStatus === 200 ? "requested" : "pending" });
    const [endpoint, options] = send.mock.calls[1];
    expect(endpoint).toBe("https://test.supabase.co/auth/v1/admin/users");
    expect(JSON.parse(String(options?.body))).toMatchObject({ email_confirm: false, user_metadata: { username: "Player" } });
    expect(send.mock.calls[2][0]).toContain("/auth/v1/resend?");
  });

  it("não chama Auth quando o Turnstile informa outro domínio", async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, hostname: "other.example" }));
    const result = await registerAccount(request(), env, send);
    expect(result.status).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
