import { useCallback, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import { Turnstile } from "../components/Turnstile";
import { configured } from "../config";
import { authenticate } from "../services/supabase";
import { enter, parseInvite } from "../services/rooms";
import { explain } from "../services/errors";
import type { Entry } from "../types";
import {AdminEntry} from '../components/AdminEntry';
import {RoomCapacity,DEFAULT_CAPACITY} from '../components/RoomCapacity';
export function HomePage({
  onEnter,
  message,
}: {
  onEnter: (entry: Entry, self: string, invite: string) => void;
  message?: string;
}) {
  const [nickname, setNickname] = useState(
    () => localStorage.getItem("streamlite-nickname") ?? "",
  );
  const [invite, setInvite] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("convite") ?? "",
  );
  const [joining, setJoining] = useState(() => Boolean(invite));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const clearError = useCallback((e: unknown) => setError(explain(e)), []);
  const enterRoom = async (join: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (nickname.trim().length < 2)
        throw new Error("Escolha um apelido de 2 a 24 caracteres.");
      const id = await authenticate(captcha);
      const data = await enter(nickname, join ? invite : undefined, capacity);
      localStorage.setItem("streamlite-nickname", nickname.trim());
      const token = data.invite ?? invite;
      // Normalize a pasted URL before preserving the invitation in the fragment.
      const normalized = parseInvite(token);
      setInvite(normalized);
      history.replaceState(null, "", `/#convite=${normalized}`);
      onEnter(data, id, normalized);
    } catch (e) {
      clearError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="home">
      <header className="home-header">
        <Brand />
        <AdminEntry/>
      </header>
      <main className="home-main">
        <section className="entry-card" aria-label="Criar ou entrar em uma sala">
          <div className="card-top">
            <span className="card-symbol">
              <Icon name="screen" size={23} />
            </span>
            <span className="mini-tag">SALA PRIVADA</span>
          </div>
          <nav className="entry-nav" aria-label="Opções da sala">
            <button type="button" className="secondary" aria-pressed={!joining} disabled={busy} onClick={() => { setJoining(false); setError(""); }}>Criar sala</button>
            <button type="button" className="secondary" aria-pressed={joining} disabled={busy} onClick={() => { setJoining(true); setError(""); }}>Entrar na sala</button>
          </nav>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (configured && (!joining || invite.trim())) void enterRoom(joining);
            }}
          >
            <label htmlFor="nickname">Como podemos te chamar?</label>
            <input
              id="nickname"
              autoComplete="nickname"
              placeholder="Seu apelido"
              minLength={2}
              maxLength={24}
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={busy}
            />
            {joining ? (
              <>
                <label htmlFor="invite">Recebeu um convite?</label>
                <div className="input-icon">
                  <Icon name="link" size={18} />
                  <input
                    id="invite"
                    required
                    placeholder="Cole o link ou código de convite"
                    autoComplete="off"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </>
            ) : (
              <RoomCapacity value={capacity} onChange={setCapacity} disabled={busy} />
            )}
            <button className="primary wide" type="submit" disabled={busy || !configured || (joining && !invite.trim())}>
              {!joining && <Icon name="plus" />}
              {busy ? "Conectando…" : joining ? "Entrar na sala" : "Criar sala"}
              <Icon name="arrow" size={18} />
            </button>
            <Turnstile
              key={busy ? "busy" : "idle"}
              onToken={setCaptcha}
              onError={setError}
            />
          </form>
          {!configured && (
            <div className="notice">
              Configure as variáveis do Supabase em <code>.env</code> para criar
              e acessar salas. As instruções estão no README.
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="card-footer">
            <Icon name="lock" size={14} />
            Sua sala só abre para quem tem o convite.
          </div>
        </section>
      </main>
      <footer className="home-footer">
        <span>
          Chrome ou Edge no Windows <span className="footer-separator">/</span>{" "}
          WebRTC P2P
        </span>
      </footer>
    </div>
  );
}
