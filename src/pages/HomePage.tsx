import { useCallback, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import { Turnstile } from "../components/Turnstile";
import { configured } from "../config";
import { authenticate } from "../services/supabase";
import { enter, parseInvite } from "../services/rooms";
import { explain } from "../services/errors";
import type { Entry } from "../types";
export function HomePage({
  onEnter,
}: {
  onEnter: (entry: Entry, self: string, invite: string) => void;
}) {
  const [nickname, setNickname] = useState(
    () => localStorage.getItem("streamlite-nickname") ?? "",
  );
  const [invite, setInvite] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("convite") ?? "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const clearError = useCallback((e: unknown) => setError(explain(e)), []);
  const enterRoom = async (join: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (nickname.trim().length < 2)
        throw new Error("Escolha um apelido de 2 a 24 caracteres.");
      const id = await authenticate(captcha);
      const data = await enter(nickname, join ? invite : undefined);
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
        <span className="header-tag">
          <span className="status-dot" />
          Seu jogo. Sua galera.
        </span>
      </header>
      <main className="home-main">
        <div className="hero">
          <div className="eyebrow">
            <span /> UM BOM JOGO FICA MELHOR JUNTO
          </div>
          <h1>
            Seu jogo na tela.
            <br />
            Seus amigos
            <br />
            <span>por perto.</span>
          </h1>
          <p className="hero-description">
            Compartilhe aquele momento com quem joga com você. Vídeo e áudio em
            uma sala privada, direto do navegador.
          </p>
          <div className="feature-row">
            <span>
              <Icon name="lock" size={17} />
              Só por convite
            </span>
            <span>
              <Icon name="users" size={17} />
              Até 5 pessoas
            </span>
            <span>
              <Icon name="screen" size={17} />
              Sem instalar nada
            </span>
          </div>
          <div
            className="signal-art"
            aria-label="Vídeo enviado diretamente do seu navegador aos seus amigos"
          >
            <div className="art-host">
              <Icon name="screen" size={28} />
              <span>Seu jogo</span>
            </div>
            <div className="art-line" />
            <div className="art-friends">
              {["A", "B", "C", "D"].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <small>Conexão direta. Momentos compartilhados.</small>
          </div>
        </div>
        <section className="entry-card" aria-labelledby="entry-title">
          <div className="card-top">
            <span className="card-symbol">
              <Icon name="screen" size={23} />
            </span>
            <span className="mini-tag">SALA PRIVADA</span>
          </div>
          <h2 id="entry-title">Bora assistir juntos?</h2>
          <p>Escolha seu apelido e reúna a galera.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enterRoom(!!invite);
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
            <button
              className="primary wide"
              type="button"
              disabled={busy || !configured}
              onClick={() => void enterRoom(false)}
            >
              <Icon name="plus" />
              {busy ? "Conectando…" : "Criar sala"}
              <Icon name="arrow" size={18} />
            </button>
            <div className="divider">
              <span />
              ou entre em uma sala
              <span />
            </div>
            <label htmlFor="invite">Recebeu um convite?</label>
            <div className="input-icon">
              <Icon name="link" size={18} />
              <input
                id="invite"
                placeholder="Cole o link ou código de convite"
                autoComplete="off"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                disabled={busy}
              />
            </div>
            <button
              className="secondary wide"
              type="submit"
              disabled={busy || !invite || !configured}
            >
              Entrar na sala
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
        <span>FEITO PARA COMPARTILHAR O PLAY</span>
        <span>
          Chrome ou Edge no Windows <span className="footer-separator">/</span>{" "}
          WebRTC P2P
        </span>
      </footer>
    </div>
  );
}
