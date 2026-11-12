import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import type { Session } from "@supabase/supabase-js";
import { Brand, Icon } from "./components/Icon";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { loadProfile, type Profile } from "./services/accounts";
import { explain } from "./services/errors";
import { client, prepareAuth } from "./services/supabase";
import type { Entry } from "./types";

const RoomPage = lazy(() =>
  import("./pages/RoomPage").then((module) => ({ default: module.RoomPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })),
);
const recoveryPath = location.pathname === "/recuperar";
const callbackParams = new URLSearchParams(location.hash.slice(1));
const authCallbackFailed = callbackParams.has("error");
const recoveryLink = recoveryPath && callbackParams.get("type") === "recovery" && callbackParams.has("access_token");

function AccessState({ message, busy, action }: {
  message: string;
  busy?: boolean;
  action?: () => void;
}) {
  return <main className="account-shell">
    <Brand />
    <section className="entry-card account-card">
      <p role={busy ? "status" : "alert"}>{message}</p>
      {!busy && (action ? <button className="secondary" onClick={action}>Sair</button> : <a href="/">Voltar ao início</a>)}
    </section>
  </main>;
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [recovery, setRecovery] = useState(false);
  const [profile, setProfile] = useState<Profile | null>();
  const [error, setError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const user = session?.user;
  const id = user && !user.is_anonymous && user.email_confirmed_at ? user.id : null;

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    void prepareAuth().then((auth) => {
      if (disposed) return;
      const { data } = auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" && recoveryLink) setRecovery(true);
        // Read this tab's storage outside the Auth lock, including after cross-tab events.
        clearTimeout(pending);
        pending = setTimeout(() => {
          void auth.getSession().then(({ data, error }) => {
            if (disposed) return;
            setSession(data.session);
            void client().realtime.setAuth().catch(() => undefined);
            if (error && data.session) setError(explain(error));
          }).catch((cause) => { if (!disposed) setError(explain(cause)); });
        }, 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch((cause) => { if (!disposed) setError(explain(cause)); });
    return () => {
      disposed = true;
      clearTimeout(pending);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!id || recoveryPath) return;
    const currentId = id;
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const account = await loadProfile(currentId);
        if (!disposed) {
          setProfile(account);
          setError("");
        }
      } catch (cause) {
        if (!disposed) setError(explain(cause));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [id]);

  async function logout() {
    setLogoutError("");
    try {
      const auth = await prepareAuth();
      const { error } = await auth.signOut({ scope: "local" });
      if (error) throw error;
      setProfile(undefined);
      setError("");
      if (location.pathname === "/admin") location.replace("/");
    } catch (cause) {
      setLogoutError(explain(cause));
    }
  }

  if (session === undefined) return <AccessState busy={!error} message={error || "Verificando sessão…"} />;
  if (recoveryPath) {
    return recovery && session ? <AuthPage recovery /> :
      <AccessState message="Link inválido ou expirado. Solicite um novo link de recuperação." />;
  }
  if (!session || user?.is_anonymous) {
    const message = authCallbackFailed ? "Link inválido ou expirado." :
      new URLSearchParams(location.search).get("senha") === "atualizada" ? "Senha atualizada. Entre novamente." : "";
    return <AuthPage initialMessage={message} />;
  }
  const signOut = () => void logout();
  if (!id) return <AccessState action={signOut} message={logoutError || "Confirme seu e-mail para continuar."} />;
  if ((profile && profile.id !== id) || profile === undefined)
    return <AccessState action={error ? signOut : undefined} busy={!error} message={logoutError || error || "Carregando perfil…"} />;
  if (profile?.status !== "active")
    return <AccessState action={signOut} message={logoutError || (profile ? "Sua conta está bloqueada. Entre em contato com um administrador." : "Perfil indisponível. Entre novamente ou fale com um administrador.")} />;

  return <>
    {logoutError && <p className="error" role="alert">{logoutError}</p>}
    {location.pathname === "/admin" ? profile.role === "user" ?
      <AccessState message="Acesso administrativo restrito." /> :
      <Suspense fallback={<AccessState busy message="Abrindo administração…" />}>
        <AdminPage key={profile.id} profile={profile} logout={signOut} />
      </Suspense> :
      <Rooms key={profile.id} profile={profile} email={user?.email} logout={signOut} />}
  </>;
}

function Rooms({ profile, email, logout }: { profile: Profile; email?: string; logout: () => void }) {
  const [message, setMessage] = useState("");
  const [room, setRoom] = useState<{ entry: Entry; invite: string } | null>(null);
  const leave = useCallback((reason?: string) => {
    setMessage(reason ?? "");
    setRoom(null);
    if (!reason) history.replaceState(null, "", "/");
  }, []);
  const adminLink = profile.role !== "user" && (
    <a className="account-control account-control--admin" href="/admin">
      <Icon name="lock" size={16} /> Administração
    </a>
  );
  return room ? (
    <Suspense fallback={<p role="status">Abrindo sala…</p>}>
      <RoomPage initial={room.entry} self={profile.id} invite={room.invite} onLeave={leave}
        accountActions={adminLink} onLogout={logout} />
    </Suspense>
  ) : (
    <HomePage profile={profile} email={email} message={message}
      accountActions={<>
        {adminLink}
        <button type="button" className="account-control account-control--exit" onClick={logout}>
          <Icon name="exit" size={16} /> Sair da conta
        </button>
      </>}
      onEnter={(entry, invite) => {
        setMessage("");
        setRoom({ entry, invite });
      }}
    />
  );
}
