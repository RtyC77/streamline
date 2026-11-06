// Runs in Vite's build process, before public values can reach a browser bundle.
export function validatePublicEnvironment(values: Record<string, string>) {
  const key = values.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !key.startsWith("sb_publishable_"))
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY deve conter uma chave pública sb_publishable_. Chaves secretas não podem entrar no build.",
    );
  const raw = values.VITE_SUPABASE_URL;
  if (raw) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("VITE_SUPABASE_URL deve ser uma URL válida.");
    }
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error(
        "VITE_SUPABASE_URL deve usar HTTPS ou um endereço local de desenvolvimento.",
      );
  }
  if (
    values.VITE_ICE_TRANSPORT_POLICY &&
    !["all", "relay"].includes(values.VITE_ICE_TRANSPORT_POLICY)
  )
    throw new Error("VITE_ICE_TRANSPORT_POLICY deve ser all ou relay.");
}
