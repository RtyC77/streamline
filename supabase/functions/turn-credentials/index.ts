// Deploy only if you operate a TURN service supporting coturn REST credentials.
// No service_role key is needed. Authorization always uses the caller's JWT.
declare const Deno: {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (req: Request) => Promise<Response>) => void;
};
export interface TurnEnvironment {
  get: (name: string) => string | undefined;
}
export async function handleTurn(
  req: Request,
  env: TurnEnvironment,
): Promise<Response> {
  const allowed = (env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const respond = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!allowed.includes(origin))
    return respond(403, { error: "Origem não autorizada." });
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Headers"] =
    "authorization, apikey, content-type, x-client-info";
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return respond(405, { error: "Método não permitido." });
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer "))
    return respond(401, { error: "Autenticação necessária." });
  try {
    const url = env.get("SUPABASE_URL"),
      publicKey = env.get("PUBLIC_SUPABASE_KEY"),
      secret = env.get("TURN_SHARED_SECRET");
    const urls = (env.get("TURN_URLS") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (
      !url ||
      !publicKey ||
      !secret ||
      !urls.length ||
      !urls.every((u) => /^turns?:/.test(u))
    )
      return respond(503, { error: "TURN não configurado." });
    const payload: unknown = await req.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("roomId" in payload) ||
      typeof payload.roomId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(payload.roomId)
    )
      return respond(400, { error: "Sala inválida." });
    const requestHeaders = {
      Authorization: auth,
      apikey: publicKey,
      "Content-Type": "application/json",
    };
    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(8000),
    });
    if (!userResponse.ok) return respond(401, { error: "Sessão inválida." });
    const user = (await userResponse.json()) as { id?: string };
    if (!user.id || !/^[a-f0-9-]{36}$/.test(user.id))
      return respond(401, { error: "Sessão inválida." });
    const permission = await fetch(`${url}/rest/v1/rpc/authorize_turn`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ p_room: payload.roomId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!permission.ok || (await permission.json()) !== true)
      return respond(403, {
        error: "Sem acesso à sala ou limite de tentativas excedido.",
      });
    // One-hour credentials, refreshed by the client every twenty minutes.
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const username = `${expires}:${user.id}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(username),
    );
    const credential = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return respond(200, {
      iceServers: [{ urls, username, credential }],
      expiresAt: expires,
    });
  } catch {
    return respond(500, { error: "Não foi possível gerar credenciais TURN." });
  }
}
if (typeof Deno !== "undefined") Deno.serve((req) => handleTurn(req, Deno.env));
