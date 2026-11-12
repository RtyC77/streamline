import type { GoTrueClient, SupabaseClient } from "@supabase/supabase-js";
import { configured, parseIce } from "../config";
let supabase: SupabaseClient | null = null;
let authClient: GoTrueClient;
let loading: Promise<SupabaseClient> | null = null;
const rememberKey = "streamlite-remember-session";
export function rememberSession(remember: boolean) {
  sessionStorage.setItem(rememberKey, remember ? "yes" : "no");
}

// Supabase owns the session lifecycle. A tab-only login uses sessionStorage.
const authStorage = {
  getItem(key: string) {
    return sessionStorage.getItem(key) ??
      (sessionStorage.getItem(rememberKey) === "no" ? null : localStorage.getItem(key));
  },
  setItem(key: string, value: string) {
    if (sessionStorage.getItem(rememberKey) === "yes" ||
      (!sessionStorage.getItem(rememberKey) && localStorage.getItem(key))) {
      localStorage.setItem(key, value);
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  },
  removeItem(key: string) {
    const local = sessionStorage.getItem(rememberKey) === "yes" ||
      (!sessionStorage.getItem(rememberKey) && !sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    if (local) localStorage.removeItem(key);
  },
};
export async function prepareClient(): Promise<SupabaseClient> {
  if (!configured)
    throw new Error("Configure o Supabase no arquivo .env para conectar.");
  if (supabase) return supabase;
  loading ??= import("@supabase/supabase-js")
    .then(({ createClient, AuthClient }) => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      authClient = new AuthClient({
        url: `${url.replace(/\/$/, "")}/auth/v1`,
        headers: { apikey: key },
        storageKey: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`,
        storage: authStorage,
        flowType: "implicit",
      });
      supabase = createClient(
        url,
        key,
        {
          // Only this tab's stored session supplies REST, Functions and Realtime tokens.
          accessToken: async () => (await authClient.getSession()).data.session?.access_token ?? null,
          global: {
            fetch: (input, options) => {
              const url = typeof input === "string" || input instanceof URL ? input : input.url;
              const leavingRoom = options?.method === "POST" && new URL(url).pathname.endsWith("/rest/v1/rpc/leave_room");
              return fetch(input, {
                ...options,
                keepalive: leavingRoom || options?.keepalive,
                signal: options?.signal
                  ? AbortSignal.any([
                      options.signal,
                      AbortSignal.timeout(15_000),
                    ])
                  : AbortSignal.timeout(15_000),
              });
            },
          },
        },
      );
      return supabase;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
export async function prepareAuth() {
  await prepareClient();
  return authClient;
}
export function client() {
  if (!supabase)
    throw new Error("Configure o Supabase no arquivo .env para conectar.");
  return supabase;
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
