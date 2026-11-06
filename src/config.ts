export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const target = {
  width: 1280,
  height: 720,
  fps: 30,
  bitrate: 3_000_000,
  minBitrate: 2_500_000,
  maxBitrate: 4_000_000,
};
export function parseIce(raw?: string): RTCIceServer[] {
  const servers: unknown = JSON.parse(
    raw || '[{"urls":"stun:stun.cloudflare.com:3478"}]',
  );
  if (
    !Array.isArray(servers) ||
    servers.length > 10 ||
    !servers.every(
      (s) =>
        s &&
        typeof s === "object" &&
        "urls" in s &&
        (typeof s.urls === "string" ||
          (Array.isArray(s.urls) &&
            s.urls.every((u: unknown) => typeof u === "string"))),
    )
  )
    throw new Error("Configuração ICE inválida. Verifique VITE_ICE_SERVERS.");
  return servers as RTCIceServer[];
}
