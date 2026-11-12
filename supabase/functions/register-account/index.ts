type Env = { get(name: string): string | undefined };
declare const Deno: { env: Env; serve(handler: (request: Request) => Promise<Response>): void };

export async function registerAccount(request: Request, env: Env, send = fetch): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowed = env.get("REGISTRATION_ORIGINS")?.split(",").map(value => value.trim()) ?? [];
  const trusted = origin && allowed.includes(origin);
  const headers = {
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...(trusted ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reply = (body: object, status = 200) => Response.json(body, { status, headers });
  if (!trusted) return reply({ error: "Origem não autorizada." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Método não permitido." }, 405);

  const url = env.get("SUPABASE_URL");
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = env.get("REGISTRATION_TURNSTILE_SECRET");
  if (!url || !key || !secret) return reply({ error: "O cadastro está temporariamente indisponível." }, 503);

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = body?.password;
  const captcha = body?.captcha;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[A-Za-z0-9_.-]{2,24}$/.test(username) ||
      typeof password !== "string" || password.length < 8 || new TextEncoder().encode(password).length > 72 ||
      typeof captcha !== "string" || !captcha || captcha.length > 2048) {
    return reply({ error: "Confira os dados e a verificação de segurança do cadastro." }, 400);
  }

  const post = (endpoint: string, payload: object, requestHeaders: Record<string, string> = {}) =>
    send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...requestHeaders },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  try {
    const challenge = await post("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      secret, response: captcha,
    });
    const result = await challenge.json();
    if (!challenge.ok || result.success !== true || result.hostname !== new URL(origin).hostname) {
      return reply({ error: "Refaça a verificação de segurança e tente novamente." }, 403);
    }

    const auth = `${url.replace(/\/$/, "")}/auth/v1`;
    const credentials = { apikey: key, Authorization: `Bearer ${key}` };
    const created = await post(`${auth}/admin/users`, {
      email, password, user_metadata: { username }, email_confirm: false,
    }, credentials);
    if (!created.ok) {
      const error = await created.json().catch(() => null);
      const code = error?.error_code ?? error?.code;
      if (code === "email_exists" || code === "user_already_exists") return reply({ confirmation: "unknown" });
      if (code === "weak_password") return reply({ error: "A senha não atende às regras de segurança." }, 400);
      return reply({ error: "Não foi possível criar a conta. Confira se o nome de usuário está disponível." }, 422);
    }

    // The account and its profile are committed before attempting email delivery.
    const redirect = encodeURIComponent(new URL("/", origin).href);
    const sent = await post(`${auth}/resend?redirect_to=${redirect}`, { type: "signup", email }, credentials)
      .then(response => response.ok, () => false);
    return reply({ confirmation: sent ? "requested" : "pending" });
  } catch {
    return reply({ error: "O serviço de cadastro não respondeu. Tente novamente mais tarde." }, 503);
  }
}

if (typeof Deno !== "undefined") Deno.serve(request => registerAccount(request, Deno.env));
