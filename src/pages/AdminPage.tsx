import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import {
  closeStaffRoom, confirmUserEmail, staffAudit, staffRooms, staffUsers, updateUser,
  type AuditEntry, type Profile, type StaffRoom, type StaffUser,
} from "../services/accounts";
import { explain } from "../services/errors";

const roleNames = { user: "Usuário", admin: "Admin", superadmin: "SuperAdmin" };
const statusNames = { active: "Ativa", blocked: "Bloqueada" };
const actionNames: Record<string, string> = {
  grant_rooms: "Autorizar criação de salas",
  revoke_rooms: "Revogar criação de salas",
  block: "Bloquear conta",
  unblock: "Desbloquear conta",
  promote: "Promover para Admin",
  demote: "Rebaixar para usuário",
  bootstrap: "Inicializar SuperAdmin",
  close_room: "Finalizar sala",
  confirm_email: "Confirmar e-mail manualmente",
};
const pageSize = 25;

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Indisponível";
}

function Pagination({ page, more, change }: { page: number; more: boolean; change: (page: number) => void }) {
  if (!page && !more) return null;
  return <nav className="account-actions" aria-label="Paginação">
    <button className="secondary" disabled={page === 0} onClick={() => change(page - 1)}>Anterior</button>
    <span>Página {page + 1}</span>
    <button className="secondary" disabled={!more} onClick={() => change(page + 1)}>Próxima</button>
  </nav>;
}

export function AdminPage({ profile, logout }: { profile: Profile; logout: () => void }) {
  const content = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<"users" | "audit" | "rooms">("users");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [rooms, setRooms] = useState<StaffRoom[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const superadmin = profile.role === "superadmin";

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    const offset = page * pageSize;
    const timer = setTimeout(() => {
      async function load() {
        try {
          if (tab === "users") {
            const result = await staffUsers(search.trim(), status, role, offset);
            if (!disposed) setUsers(result);
          } else if (tab === "audit") {
            const result = await staffAudit(offset);
            if (!disposed) setAudit(result);
          } else if (superadmin) {
            const result = await staffRooms();
            if (!disposed) setRooms(result);
          }
        } catch (cause) {
          if (!disposed) setError(explain(cause));
        } finally {
          if (!disposed) setLoading(false);
        }
      }
      void load();
    }, tab === "users" ? 200 : 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [tab, search, status, role, page, revision, superadmin]);

  function changeTab(next: typeof tab) {
    setError("");
    setNotice("");
    setPage(0);
    setTab(next);
  }

  function changePage(next: number) {
    setPage(next);
    content.current?.scrollTo(0, 0);
    content.current?.focus({ preventScroll: true });
  }

  async function run(action: () => Promise<unknown>, success: string, alreadyDone = "A sala já foi encerrada.") {
    if (acting) return;
    setActing(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result === false) setNotice(alreadyDone);
      else setNotice(success);
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setRevision((value) => value + 1);
      setActing(false);
    }
  }

  function actionButton(user: StaffUser, action: string, destructive = false) {
    const label = actionNames[action];
    return <button key={action} className={destructive ? "danger" : "secondary"} disabled={acting}
      onClick={() => {
        if (destructive && !window.confirm(`${label} para ${user.username}?`)) return;
        void run(() => updateUser(user, action), "Conta atualizada.");
      }}>{label}</button>;
  }

  return <div className="admin-page">
    <header className="home-header">
      <Brand />
      <div className="account-actions">
        <span className="admin-identity">{profile.username} · {roleNames[profile.role]}</span>
        <a className="account-control" href="/"><Icon name="screen" size={16} /> Salas</a>
        <button type="button" className="account-control account-control--exit" onClick={logout}>
          <Icon name="exit" size={16} /> Sair da conta
        </button>
      </div>
    </header>
    <main className="admin-scroll" ref={content} tabIndex={0} aria-labelledby="admin-title">
      <h1 id="admin-title">Administração</h1>
      <nav className="account-actions admin-sections" aria-label="Seções administrativas">
        <button className="secondary" aria-pressed={tab === "users"} onClick={() => changeTab("users")}><Icon name="users" size={16} /> Usuários</button>
        <button className="secondary" aria-pressed={tab === "audit"} onClick={() => changeTab("audit")}><Icon name="chart" size={16} /> Histórico</button>
        {superadmin && <button className="secondary" aria-pressed={tab === "rooms"} onClick={() => changeTab("rooms")}><Icon name="screen" size={16} /> Salas ativas</button>}
        <button className="secondary" disabled={loading || acting}
          onClick={() => { setError(""); setRevision((value) => value + 1); }}>Atualizar</button>
      </nav>
      {tab === "users" && <div className="admin-filters">
        <label>Nome ou e-mail
          <input type="search" maxLength={254} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setError(""); }} />
        </label>
        <label>Status
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); setError(""); }}>
            <option value="">Todos</option><option value="active">Ativa</option><option value="blocked">Bloqueada</option>
          </select>
        </label>
        <label>Cargo
          <select value={role} onChange={(event) => { setRole(event.target.value); setPage(0); setError(""); }}>
            <option value="">Todos</option>
            {Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {loading ? <p role="status">Carregando…</p> : tab === "users" ? <>
        {!users.length && <p>Nenhum usuário nesta página.</p>}
        <ul className="admin-list">
          {users.slice(0, pageSize).map((user) => {
            const editable = user.id !== profile.id && (superadmin || user.role !== "superadmin");
            const canBlock = superadmin || user.role === "user";
            return <li key={user.id}>
              <h2>{user.username}</h2>
              <p>{user.email}{!user.email_confirmed_at && " · E-mail pendente"}</p>
              <dl>
                <div><dt>Cargo</dt><dd>{roleNames[user.role]}</dd></div>
                <div><dt>Status</dt><dd>{statusNames[user.status]}</dd></div>
                <div><dt>Criação de salas</dt><dd>{user.can_create_rooms ? "Autorizada" : "Pendente"}</dd></div>
                <div><dt>Cadastro</dt><dd>{date(user.created_at)}</dd></div>
                <div><dt>Último login</dt><dd>{date(user.last_sign_in_at)}</dd></div>
              </dl>
              {editable && <div className="account-actions">
                {user.role === "user" && user.status === "active" && !user.email_confirmed_at &&
                  <button type="button" className="secondary" disabled={acting} onClick={() => {
                    if (window.confirm(`Confirmar manualmente o e-mail de ${user.username} (${user.email})? Faça isso apenas se verificou que o endereço pertence à pessoa. Ela poderá entrar com a senha do cadastro.`)) {
                      void run(() => confirmUserEmail(user), "E-mail confirmado. A pessoa já pode entrar com sua senha.", "O e-mail já estava confirmado.");
                    }
                  }}>{actionNames.confirm_email}</button>}
                {user.can_create_rooms ? actionButton(user, "revoke_rooms", true) : actionButton(user, "grant_rooms")}
                {canBlock && (user.status === "blocked" ? actionButton(user, "unblock") : actionButton(user, "block", true))}
                {superadmin && user.role === "user" && actionButton(user, "promote")}
                {superadmin && user.role === "admin" && actionButton(user, "demote", true)}
              </div>}
            </li>;
          })}
        </ul>
        <Pagination page={page} more={users.length > pageSize} change={changePage} />
      </> : tab === "audit" ? <>
        {!audit.length && <p>Nenhum registro nesta página.</p>}
        <ul className="admin-list">
          {audit.slice(0, pageSize).map((entry) => <li key={entry.id}>
            <h2>{actionNames[entry.action] ?? entry.action}</h2>
            <p>{entry.actor_name} → {entry.target_name} · {date(entry.created_at)}</p>
            <dl>
              <div><dt>Estado anterior</dt><dd><code>{JSON.stringify(entry.previous_state)}</code></dd></div>
              <div><dt>Novo estado</dt><dd><code>{JSON.stringify(entry.new_state)}</code></dd></div>
            </dl>
          </li>)}
        </ul>
        <Pagination page={page} more={audit.length > pageSize} change={changePage} />
      </> : superadmin && <>
        {!rooms.length && <p>Nenhuma sala ativa.</p>}
        <ul className="admin-list">{rooms.map((room) => <li key={room.id}>
          <h2>{room.name}</h2>
          <p>{room.participants} participante(s) · {room.transmitting ? "Transmitindo" : "Sem transmissão"}</p>
          <button className="danger admin-room-action" disabled={acting} onClick={() => {
            if (window.confirm(`Finalizar ${room.name}?`)) void run(() => closeStaffRoom(room.id), "Sala finalizada.");
          }}>Finalizar sala</button>
        </li>)}</ul>
      </>}
    </main>
  </div>;
}
