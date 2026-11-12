import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import { Turnstile } from "../components/Turnstile";
import { configured } from "../config";
import { authenticate } from "../services/supabase";
import { createListedRoom, enter, inviteLink, isRoomId, joinListedRoom, listRooms, parseInvite, type ListedRoom } from "../services/rooms";
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
  const [target, setTarget] = useState<{ id: string; name?: string; private?: boolean } | null>(() => {
    const id = new URLSearchParams(location.hash.slice(1)).get("sala");
    return id && isRoomId(id) ? { id } : null;
  });
  const [joining, setJoining] = useState(() => Boolean(invite || target));
  const [access, setAccess] = useState<"public" | "private">("public");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<ListedRoom[] | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  const [page, setPage] = useState(0);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  useEffect(() => {
    if (!configured) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await listRooms(page * 25);
        if (active) {
          setRooms(result);
          setDirectoryError("");
        }
      } catch (cause) {
        if (active) setDirectoryError(explain(cause));
      } finally {
        if (active) timer = setTimeout(refresh, 15_000);
      }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [page]);
  const changeMode = (join: boolean) => {
    setJoining(join);
    setPassword("");
    setError("");
  };
  const selectRoom = (room: ListedRoom) => {
    changeMode(true);
    setTarget(room.access_mode === "invite" ? null : {
      id: room.id, name: room.name, private: room.access_mode === "private",
    });
    nicknameInput.current?.focus();
  };
  const enterRoom = async (join: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (nickname.trim().length < 2)
        throw new Error("Escolha um apelido de 2 a 24 caracteres.");
      const id = await authenticate(captcha);
      const data = join
        ? target ? await joinListedRoom(target.id, nickname, password) : await enter(nickname, invite)
        : await createListedRoom(nickname, capacity, access, password);
      localStorage.setItem("streamlite-nickname", nickname.trim());
      const normalized = join && !target ? parseInvite(invite) : data.room.id;
      history.replaceState(null, "", inviteLink(normalized));
      onEnter(data, id, normalized);
    } catch (e) {
      setError(explain(e));
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
          <nav className="entry-nav" aria-label="Opções da sala">
            <button type="button" aria-pressed={!joining} disabled={busy} onClick={() => changeMode(false)}><Icon name="plus" size={19} /> Criar sala</button>
            <button type="button" aria-pressed={joining} disabled={busy} onClick={() => changeMode(true)}><Icon name="link" size={19} /> Entrar na sala</button>
          </nav>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (configured && (!joining || target || invite.trim())) void enterRoom(joining);
            }}
          >
            <label htmlFor="nickname">Como podemos te chamar?</label>
            <input
              id="nickname"
              ref={nicknameInput}
              autoComplete="nickname"
              placeholder="Seu apelido"
              minLength={2}
              maxLength={24}
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={busy}
            />
            {joining && target ? (
              <div className="selected-room">
                <strong>{target.name ?? "Sala do link"}</strong>
                <button className="secondary" type="button" disabled={busy} onClick={() => { setTarget(null); setPassword(""); }}>Trocar sala</button>
              </div>
            ) : joining ? (
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
                    onChange={(e) => {
                      const value = e.target.value;
                      setInvite(value);
                      try {
                        const id = new URLSearchParams(new URL(value).hash.slice(1)).get("sala");
                        if (id && isRoomId(id)) setTarget({ id });
                      } catch { /* Keep accepting legacy invite codes and partial input. */ }
                    }}
                    disabled={busy}
                  />
                </div>
              </>
            ) : (
              <>
                <label htmlFor="room-access">Acesso à sala</label>
                <select id="room-access" value={access} disabled={busy} onChange={(e) => { setAccess(e.target.value === "private" ? "private" : "public"); setPassword(""); }}>
                  <option value="public">Pública</option>
                  <option value="private">Privada</option>
                </select>
                <RoomCapacity value={capacity} onChange={setCapacity} disabled={busy} />
              </>
            )}
            {((!joining && access === "private") || (joining && target && target.private !== false)) && (
              <>
                <label htmlFor="room-password">{joining && target?.private === undefined ? "Senha, se a sala for privada" : "Senha da sala"}</label>
                <input id="room-password" type="password" autoComplete={joining ? "current-password" : "new-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
                  required={!joining || target?.private === true} minLength={joining ? undefined : 4} maxLength={72} />
              </>
            )}
            <button className="primary wide" type="submit" disabled={busy || !configured || (joining && !target && !invite.trim())}>
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
        </section>
        <section className="room-directory" aria-labelledby="room-directory-title">
          <h1 id="room-directory-title"><Icon name="users" size={22} /> Salas disponíveis</h1>
          {directoryError && <p role="status">Não foi possível carregar as salas. {directoryError}</p>}
          {configured && !rooms && !directoryError && <p role="status">Carregando salas…</p>}
          {rooms?.length === 0 && <p className="directory-empty">Nenhuma sala disponível nesta página.</p>}
          <ul className="room-directory-list">
            {rooms?.slice(0, 25).map((room) => (
              <li key={room.id}>
                <span className="directory-room-icon">
                  <Icon name={room.access_mode === "public" ? "screen" : "lock"} size={24} />
                </span>
                <div className="directory-room-info">
                  <h2>{room.name}</h2>
                  <p>{room.access_mode === "public" ? "Pública" : room.access_mode === "private" ? "Privada · Senha" : "Somente por convite"} · {room.participants.length}/{room.max_members}</p>
                  {room.participants.length > 0 && (
                    <ul className="room-directory-members">
                      {room.participants.map((member, index) => (
                        <li key={index}>{member.nickname}{member.sharing && <span> · Compartilhando tela</span>}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="secondary" type="button" disabled={busy} onClick={() => selectRoom(room)}>
                  {room.access_mode === "invite" ? "Usar convite" : "Entrar"}
                </button>
              </li>
            ))}
          </ul>
          {(page > 0 || (rooms?.length ?? 0) > 25) && (
            <nav className="directory-pages" aria-label="Páginas de salas">
              <button className="secondary" disabled={page === 0} onClick={() => { setRooms(null); setPage(page - 1); }}>Anterior</button>
              <button className="secondary" disabled={(rooms?.length ?? 0) <= 25} onClick={() => { setRooms(null); setPage(page + 1); }}>Próxima</button>
            </nav>
          )}
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
