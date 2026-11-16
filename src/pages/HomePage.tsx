import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brand, Icon } from "../components/Icon";
import { configured } from "../config";
import { updateOwnUsername, type Profile } from "../services/accounts";
import { createListedRoom, enter, inviteLink, isRoomId, joinListedRoom, listRooms, parseRoomLink, type ListedRoom } from "../services/rooms";
import { explain } from "../services/errors";
import type { Entry } from "../types";
import {RoomCapacity,DEFAULT_CAPACITY} from '../components/RoomCapacity';
import { ReleaseInfo } from "../components/ReleaseInfo";

type EntryDialog =
  | { kind: "create" }
  | { kind: "invite" }
  | { kind: "link"; destination: string }
  | { kind: "password"; destination: string; name?: string };

export function HomePage({
  onEnter,
  message,
  profile,
  email,
  accountActions,
}: {
  onEnter: (entry: Entry, invite: string) => void;
  message?: string;
  profile: Profile;
  email?: string;
  accountActions: ReactNode;
}) {
  const nickname = profile.username;
  const [entryDialog, setEntryDialog] = useState<EntryDialog | null>(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get("sala");
    const destination = id && isRoomId(id) ? id : params.get("convite");
    return destination ? { kind: "link", destination } : null;
  });
  const modal = useRef<HTMLDialogElement>(null);
  const requestInProgress = useRef(false);
  const [entryValue, setEntryValue] = useState("");
  const [entryError, setEntryError] = useState("");
  const [access, setAccess] = useState<"public" | "private">("public");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<ListedRoom[] | null>(null);
  const [directoryError, setDirectoryError] = useState("");
  const [page, setPage] = useState(0);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const modalOpen = entryDialog !== null;
  useEffect(() => {
    const dialog = modal.current;
    if (!modalOpen || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [modalOpen]);
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
  const openEntry = (dialog: EntryDialog) => {
    setEntryValue("");
    setEntryError("");
    setJoinError("");
    setEntryDialog(dialog);
  };
  const closeEntry = () => {
    if (requestInProgress.current) return;
    modal.current?.close();
    setEntryDialog(null);
    setEntryValue("");
    setEntryError("");
  };
  const requestRoom = async (key: string, load: () => Promise<Entry>, onError: (cause: unknown) => void, destination?: string) => {
    if (!configured || requestInProgress.current) return;
    requestInProgress.current = true;
    setPending(key);
    try {
      const data = await load();
      const normalized = destination ?? data.room.id;
      history.replaceState(null, "", inviteLink(normalized));
      onEnter(data, normalized);
    } catch (e) {
      onError(e);
    } finally {
      requestInProgress.current = false;
      setPending(null);
    }
  };
  const joinRoom = (destination: string, options: { password?: string; name?: string; fromDialog?: boolean } = {}) => {
    const { password, name, fromDialog } = options;
    setJoinError("");
    setEntryError("");
    void requestRoom(destination, () => isRoomId(destination)
      ? joinListedRoom(destination, nickname, password ?? "")
      : enter(nickname, destination), cause => {
        const feedback = explain(cause);
        if (isRoomId(destination) && password === undefined && feedback === "Senha da sala incorreta.") {
          openEntry({ kind: "password", destination, name });
        } else if (fromDialog) {
          setEntryError(feedback);
        } else {
          setJoinError(feedback);
        }
      }, destination);
  };
  const selectRoom = (room: ListedRoom) => {
    if (requestInProgress.current) return;
    if (room.access_mode === "public") joinRoom(room.id, { name: room.name });
    else if (room.access_mode === "private") openEntry({ kind: "password", destination: room.id, name: room.name });
    else openEntry({ kind: "invite" });
  };
  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <Brand />
          <ReleaseInfo />
        </div>
        <div className="account-actions">
          {profile.can_create_rooms && (
            <button className="primary" type="button" aria-haspopup="dialog" disabled={busy || !configured}
              onClick={() => {
                setAccess("public");
                setPassword("");
                setCapacity(DEFAULT_CAPACITY);
                setCreateError("");
                openEntry({ kind: "create" });
              }}>
              <Icon name="plus" size={16} /> Criar sala
            </button>
          )}
          <details className="account-profile">
            <summary className="account-control">
              <Icon name="user" size={16} />
              <span className="account-profile-name">Perfil de {nickname}</span>
              <Icon name="chevronDown" size={14} />
            </summary>
            <div>
              <p>{email}</p>
              {nickname.toLowerCase() !== "rod" && <button className="text-action" type="button"
                aria-expanded={editingName} onClick={() => {
                  setEditingName(value => !value);
                  setProfileMessage("");
                }} disabled={savingProfile}>Alterar nome de usuário</button>}
              {nickname.toLowerCase() !== "rod" && editingName && <form onSubmit={async (event) => {
                event.preventDefault();
                if (savingProfile) return;
                const name = String(new FormData(event.currentTarget).get("username") ?? "");
                setSavingProfile(true);
                setProfileMessage("");
                try {
                  const saved = await updateOwnUsername(name);
                  setProfileMessage(`Nome salvo como ${saved}.`);
                  setEditingName(false);
                } catch (cause) {
                  setProfileMessage(explain(cause));
                } finally {
                  setSavingProfile(false);
                }
              }}>
                <label htmlFor="profile-username">Nome de usuário</label>
                <input autoFocus key={nickname} id="profile-username" name="username" defaultValue={nickname}
                  pattern={String.raw`[A-Za-z0-9_.\-]{2,24}`} required maxLength={24} disabled={savingProfile} />
                <button className="secondary" disabled={savingProfile}>Salvar</button>
              </form>}
              {profileMessage && <p role="status">{profileMessage}</p>}
            </div>
          </details>
          {accountActions}
        </div>
      </header>
      <main className="home-main">
        <section className="room-directory" aria-labelledby="room-directory-title">
          <header className="room-directory-header">
            <h1 id="room-directory-title"><Icon name="users" size={22} /> Salas disponíveis</h1>
            <button className="secondary" type="button" aria-haspopup="dialog" disabled={busy || !configured} onClick={() => openEntry({ kind: "invite" })}>
              <Icon name="link" size={16} /> Usar convite
            </button>
          </header>
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
          {joinError && (
            <div className="error" role="alert">
              {joinError}
            </div>
          )}
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
                <button className="secondary" type="button" disabled={busy} onClick={() => selectRoom(room)} aria-haspopup={room.access_mode !== "public" ? "dialog" : undefined}>
                  {room.access_mode === "invite" ? "Usar convite" : pending === room.id ? "Entrando…" : "Entrar"}
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
      {entryDialog?.kind === "create" ? (
        <dialog ref={modal} className="room-entry-dialog" aria-labelledby="create-room-title" onCancel={event => {
          event.preventDefault();
          closeEntry();
        }}>
          <h2 id="create-room-title">Criar sala</h2>
          <form onSubmit={event => {
            event.preventDefault();
            setCreateError("");
            void requestRoom("create", () => createListedRoom(nickname, capacity, access, password),
              cause => setCreateError(explain(cause)));
          }}>
            <label htmlFor="room-access">Acesso à sala</label>
            <select id="room-access" value={access} disabled={busy} onChange={event => {
              setAccess(event.target.value === "private" ? "private" : "public");
              setPassword("");
            }}>
              <option value="public">Pública</option>
              <option value="private">Privada</option>
            </select>
            <RoomCapacity value={capacity} onChange={setCapacity} disabled={busy} />
            {access === "private" && (
              <>
                <label htmlFor="create-room-password">Senha da sala</label>
                <input id="create-room-password" type="password" autoComplete="new-password"
                  value={password} onChange={event => setPassword(event.target.value)} disabled={busy}
                  required minLength={4} maxLength={72} />
              </>
            )}
            {createError && <div className="error" role="alert">{createError}</div>}
            <div className="room-entry-actions">
              <button className="secondary" type="button" disabled={busy} onClick={closeEntry}>Cancelar</button>
              <button className="primary" type="submit" disabled={busy || !configured}>
                <Icon name="plus" size={17} />
                {pending === "create" ? "Criando sala…" : "Criar sala"}
              </button>
            </div>
          </form>
        </dialog>
      ) : entryDialog && (
        <dialog ref={modal} className="room-entry-dialog" aria-labelledby="room-entry-title" onCancel={event => {
          event.preventDefault();
          closeEntry();
        }}>
          <h2 id="room-entry-title">{entryDialog.kind === "invite" ? "Usar convite" :
            entryDialog.kind === "password" && entryDialog.name ? `Entrar em ${entryDialog.name}` : "Entrar na sala"}</h2>
          <form onSubmit={event => {
            event.preventDefault();
            try {
              const destination = parseRoomLink(entryDialog.kind === "invite" ? entryValue : entryDialog.destination);
              joinRoom(destination, entryDialog.kind === "password"
                ? { password: entryValue, name: entryDialog.name, fromDialog: true }
                : { fromDialog: true });
            } catch (cause) {
              setEntryError(explain(cause));
            }
          }}>
            {entryDialog.kind !== "link" && (
              <>
                <label htmlFor="room-entry-value">{entryDialog.kind === "password" ? "Senha da sala" : "Link ou código de convite"}</label>
                <input key={entryDialog.kind} id="room-entry-value" autoFocus
                  type={entryDialog.kind === "password" ? "password" : "text"}
                  autoComplete={entryDialog.kind === "password" ? "current-password" : "off"}
                  maxLength={entryDialog.kind === "password" ? 72 : undefined}
                  value={entryValue} disabled={busy} required onChange={event => setEntryValue(event.target.value)} />
              </>
            )}
            {entryError && <div className="error" role="alert">{entryError}</div>}
            <div className="room-entry-actions">
              <button className="secondary" type="button" disabled={busy} onClick={closeEntry}>Cancelar</button>
              <button className="primary" type="submit" disabled={busy || !configured}>{busy ? "Entrando…" : "Entrar na sala"}</button>
            </div>
          </form>
        </dialog>
      )}
      <footer className="home-footer">
        <span>
          Chrome ou Edge no Windows <span className="footer-separator">/</span>{" "}
          WebRTC P2P
        </span>
        <a href="/sobre">Sobre o StreamLite</a>
      </footer>
    </div>
  );
}
