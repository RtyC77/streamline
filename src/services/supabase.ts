import { createClient } from "@supabase/supabase-js";
import { configured, parseIce } from "../config";
export const supabase = configured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        global: {
          fetch: (input, options) =>
            fetch(input, {
              ...options,
              signal: options?.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
                : AbortSignal.timeout(15_000),
            }),
        },
      },
    )
  : null;
export function client() {
  if (!supabase)
    throw new Error("Configure o Supabase no arquivo .env para conectar.");
  return supabase;
}
export async function authenticate(captchaToken?: string) {
  const api = client();
  const { data: session, error: sessionError } = await api.auth.getSession();
  if (sessionError) throw sessionError;
  if (session.session) return session.session.user.id;
  const { data, error } = await api.auth.signInAnonymously({
    options: { captchaToken },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Não foi possível iniciar a sessão.");
  return data.user.id;
}
export async function iceConfiguration(
  roomId: string,
): Promise<RTCConfiguration> {
  const servers = parseIce(import.meta.env.VITE_ICE_SERVERS);
  const fn = import.meta.env.VITE_TURN_FUNCTION;
  if (fn) {
    const { data, error } = await client().functions.invoke(fn, {
      body: { roomId },
    });
    if (error)
      throw new Error(
        "Não foi possível obter a configuração TURN. Verifique a Edge Function.",
      );
    servers.push(...parseIce(JSON.stringify(data?.iceServers)));
  }
  return {
    iceServers: servers,
    iceTransportPolicy:
      import.meta.env.VITE_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
    bundlePolicy: "max-bundle",
    iceCandidatePoolSize: 0,
  };
}
