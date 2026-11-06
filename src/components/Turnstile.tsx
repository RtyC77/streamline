import { useEffect, useRef } from "react";
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
let loading: Promise<void> | null = null;
function load() {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(
        new Error("Não foi possível carregar a verificação de segurança."),
      );
    };
    document.head.append(script);
  });
  return loading;
}
export function Turnstile({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!key) return;
    let disposed = false;
    let id: string | undefined;
    void load()
      .then(() => {
        if (!disposed && ref.current)
          id = window.turnstile?.render(ref.current, {
            sitekey: key,
            theme: "dark",
            callback: onToken,
            "expired-callback": () => onToken(""),
            "error-callback": () => onToken(""),
          });
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [onToken, onError]);
  return <div ref={ref} className="captcha" />;
}
