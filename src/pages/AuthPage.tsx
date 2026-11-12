import { useState, type FormEvent } from "react";
import { Brand } from "../components/Icon";
import { authEmailRedirect } from "../config";
import { Turnstile } from "../components/Turnstile";
import { explain } from "../services/errors";
import { prepareAuth, prepareClient, rememberSession } from "../services/supabase";

type Mode = "login" | "register" | "forgot" | "reset";

const titles: Record<Mode, string> = {
  login: "Entrar no StreamLite",
  register: "Criar conta",
  forgot: "Recuperar senha",
  reset: "Definir nova senha",
};

function authError(error: unknown, mode: Mode) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "invalid_credentials") return "E-mail ou senha inválidos.";
  if (code === "email_not_confirmed") return "A conta ainda está pendente. Use o link de confirmação ou peça à administração para liberar o acesso.";
  if (code === "unexpected_failure" && mode === "register")
    return "Não foi possível criar a conta. Verifique se o nome de usuário está disponível.";
  if (code === "over_email_send_rate_limit") {
    const email = mode === "forgot" ? "de recuperação" : "de confirmação";
    return `O serviço atingiu o limite de envio de e-mails. Se você já recebeu o link ${email}, use-o. Caso contrário, tente mais tarde.`;
  }
  if (code === "email_address_not_authorized")
    return "O serviço de e-mail não está autorizado a enviar para esse endereço. Avise a administração do StreamLite.";
  if (code === "over_request_rate_limit")
    return "O serviço recebeu muitas tentativas desta rede. Aguarde alguns minutos antes de tentar novamente.";
  if (code === "weak_password") return "A senha não atende às regras de segurança.";
  return explain(error);
}

export function AuthPage({ recovery, initialMessage = "" }: { recovery?: boolean; initialMessage?: string }) {
  const [mode, setMode] = useState<Mode>(recovery ? "reset" : "login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const independentRegistration = import.meta.env.VITE_REGISTRATION_FUNCTION === "true";
  const requiresCaptcha = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY) && mode !== "reset";
  const hasPassword = mode !== "forgot";
  const newPassword = mode === "reset" || mode === "register";

  function changeMode(next: Mode, message = "") {
    setMode(next);
    setError("");
    setNotice(message);
    setCaptcha("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    if (newPassword && password !== fields.get("confirmation")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    if (newPassword && new TextEncoder().encode(password).length > 72) {
      setError("Use uma senha de até 72 bytes.");
      return;
    }
    if (requiresCaptcha && !captcha) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const auth = await prepareAuth();
      const options = { captchaToken: captcha || undefined };
      if (mode === "login") {
        rememberSession(fields.get("remember") === "on");
        const { error } = await auth.signInWithPassword({ email, password, options });
        if (error) throw error;
      } else if (mode === "register" && independentRegistration) {
        if (!captcha) throw new Error("A verificação de segurança do cadastro está indisponível.");
        const api = await prepareClient();
        const { data, error } = await api.functions.invoke<{ confirmation: "requested" | "pending" | "unknown" }>("register-account", {
          body: { email, password, username: String(fields.get("username")).trim(), captcha },
        });
        if (error) {
          const detail = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
          throw new Error(typeof detail?.error === "string" ? detail.error : "O serviço de cadastro está indisponível. Tente mais tarde.");
        }
        setRegisteredEmail(email);
        changeMode("login", data?.confirmation === "pending"
          ? "Conta criada. O e-mail não pôde ser enviado. Peça à administração para liberar o acesso."
          : "Se a conta estiver pendente, use o link de confirmação ou peça à administração para liberar o acesso. Entre com o e-mail usado no cadastro.");
      } else if (mode === "register") {
        const { error } = await auth.signUp({
          email, password,
          options: {
            ...options,
            data: { username: String(fields.get("username")).trim() },
            emailRedirectTo: authEmailRedirect("/"),
          },
        });
        if (error) throw error;
        setRegisteredEmail(email);
        changeMode("login", "Se a conta estiver pendente, use o link de confirmação ou peça à administração para liberar o acesso.");
      } else if (mode === "forgot") {
        const { error } = await auth.resetPasswordForEmail(email, {
          ...options, redirectTo: authEmailRedirect("/recuperar"),
        });
        if (error) throw error;
        changeMode("login", "Se houver uma conta para esse e-mail, você receberá um link para redefinir a senha.");
      } else {
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        const { error: signOutError } = await auth.signOut();
        if (signOutError) throw signOutError;
        location.replace("/?senha=atualizada");
      }
    } catch (cause) {
      setError(authError(cause, mode));
    } finally {
      setBusy(false);
      setCaptcha("");
      setCaptchaAttempt((attempt) => attempt + 1);
    }
  }

  return (
    <main className="account-shell">
      <Brand />
      <section className="entry-card account-card">
        <h1>{titles[mode]}</h1>
        {notice && <p className="notice" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <form key={mode} onSubmit={(event) => void submit(event)}>
          {mode === "register" && <>
            <label htmlFor="account-username">Nome de usuário</label>
            <input id="account-username" name="username" autoComplete="username" required
              pattern={String.raw`[A-Za-z0-9_.\-]{2,24}`} maxLength={24}
              title="De 2 a 24 letras, números, pontos, hífens ou sublinhados." disabled={busy} />
          </>}
          {mode !== "reset" && <>
            <label htmlFor="account-email">E-mail</label>
            <input id="account-email" name="email" type="email" required maxLength={254}
              defaultValue={mode === "login" ? registeredEmail : undefined}
              autoComplete={mode === "login" ? "username" : "email"} disabled={busy} />
          </>}
          {hasPassword && <>
            <label htmlFor="account-password">{mode === "reset" ? "Nova senha" : "Senha"}</label>
            <input id="account-password" name="password" type="password" required
              minLength={newPassword ? 8 : undefined} disabled={busy}
              autoComplete={newPassword ? "new-password" : "current-password"} />
          </>}
          {newPassword && <>
            <label htmlFor="account-confirmation">Confirmar senha</label>
            <input id="account-confirmation" name="confirmation" type="password" required
              autoComplete="new-password" disabled={busy} />
          </>}
          {mode === "login" && <label className="account-check">
            <input name="remember" type="checkbox" disabled={busy} /> Permanecer conectado
          </label>}
          {requiresCaptcha && <Turnstile key={captchaAttempt} onToken={setCaptcha} onError={setError} />}
          <button className="primary wide" disabled={busy || (requiresCaptcha && !captcha)}>
            {busy ? "Aguarde…" : mode === "forgot" ? "Enviar link" : mode === "reset" ? "Salvar senha" : mode === "register" ? "Cadastrar" : "Entrar"}
          </button>
        </form>
        <nav className="account-actions" aria-label="Opções de acesso">
          {mode === "login" ? <>
            <button className="secondary" disabled={busy} onClick={() => changeMode("register")}>Criar conta</button>
            <button className="secondary" disabled={busy} onClick={() => changeMode("forgot")}>Esqueci minha senha</button>
          </> : mode === "reset" ? <a href="/">Voltar ao início</a> :
            <button className="secondary" disabled={busy} onClick={() => changeMode("login")}>Voltar ao login</button>}
        </nav>
      </section>
    </main>
  );
}
