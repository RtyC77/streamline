import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import { Player } from "../components/Player";
import { Diagnostics } from "../components/Diagnostics";
import { Settings } from "../components/Settings";
import { captureGame, captureSupported } from "../media/capture";
import { inviteLink } from "../services/rooms";
import { explain } from "../services/errors";
import { RoomSession } from "../services/session";
import type { MediaState, PeerMetric, Snapshot } from "../types";
import {AdminEntry} from '../components/AdminEntry';
const initialMedia: MediaState = {
  sharing: false,
  remote: null,
  audio: "Sem captura ativa",
  connections: 0,
  status: "Aguardando transmissão",
};
export function RoomPage({
  initial,
  self,
  invite,
  onLeave,
}: {
  initial: Snapshot;
  self: string;
  invite: string;
  onLeave: (reason?: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const capacity = snapshot.room.max_members ?? 5;
  const [media, setMedia] = useState(initialMedia);
  const [metrics, setMetrics] = useState<PeerMetric[]>([]);
  const [connection, setConnection] = useState("Conectando");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sharingBusy, setSharingBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [kicking, setKicking] = useState<string | null>(null);
  const kick = async (user: string) => {
    if (kicking) return;
    setKicking(user);
    try {
      await session.current?.kick(user);
    } catch (e) {
      report(e);
    } finally {
      setKicking(null);
    }
  };
  const session = useRef<RoomSession | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const report = useCallback((e: unknown) => setError(explain(e)), []);
  useEffect(() => {
    session.current?.setDiagnostics(diagnostics);
  }, [diagnostics]);
  useEffect(() => {
    let cancelled = false;
    const controller = new RoomSession(initial, self, {
      snapshot: setSnapshot,
      media: setMedia,
      metrics: setMetrics,
      error: report,
      connection: setConnection,
      expired: (reason) => {
        if (!cancelled) onLeave(reason);
      },
    });
    session.current = controller;
    void controller
      .start()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(report);
    const hide = () => {
      void controller.close();
    };
    window.addEventListener("pagehide", hide);
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload();
    };
    window.addEventListener("pageshow", show);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      void controller.close();
    };
  }, [initial, self, report, onLeave]);
  const host = snapshot.members.find(
    (m) => m.user_id === snapshot.room.broadcaster_id,
  );
  const share = async () => {
    if (sharingBusy) return;
    setSharingBusy(true);
    setError("");
    setNotice("");
    try {
      // getDisplayMedia runs immediately within the click gesture, before RPCs.
      const capture = await captureGame();
      if (!session.current) {
        capture.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await session.current.share(capture);
      const actual = capture.settings;
      setNotice(
        `${capture.audio}. ${capture.tuning}${actual.width && actual.height ? ` Captura retornada: ${actual.width} × ${actual.height}${actual.frameRate ? `, ${actual.frameRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} FPS` : ""}.` : ""}`,
      );
    } catch (e) {
      report(e);
    } finally {
      setSharingBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(invite));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(
        "Não foi possível copiar. Selecione o link de convite na barra lateral.",
      );
    }
  };
  const leave = async () => {
    try {
      await session.current?.close(true);
    } catch {
      /* Database lease expires even if the network is down. */
    } finally {
      onLeave();
    }
  };
  return (
    <div className="room-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <div className="room-info">
          <div className="section-label">SEU ESPAÇO</div>
          <h2>{snapshot.room.name}</h2>
          <span className="private-label">
            <Icon name="lock" size={13} />
            Sala privada
          </span>
        </div>
        <div className="invite-box">
          <label htmlFor="room-invite">CONVIDE A GALERA</label>
          <input
            id="room-invite"
            readOnly
            value={inviteLink(invite)}
            onFocus={(e) => e.target.select()}
          />
          <button className="secondary wide" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} size={16} />
            {copied ? "Convite copiado" : "Copiar convite"}
          </button>
        </div>
        <div className="participants">
          <div className="participant-heading">
            <span className="section-label">PARTICIPANTES</span>
            <span>
              {snapshot.members.length}
              <span className="muted"> / {capacity}</span>
            </span>
          </div>
          <ul>
            {snapshot.members.map((m, i) => (
              <li key={m.user_id}>
                <span className={`avatar avatar-${i % 4}`}>
                  {m.nickname.slice(0, 2).toUpperCase()}
                  <i />
                </span>
                <div>
                  <strong>
                    {m.nickname}
                    {m.user_id === self && <small> você</small>}
                    {m.user_id === snapshot.room.created_by && (
                      <small> host</small>
                    )}
                  </strong>
                  <span>
                    {m.user_id === snapshot.room.broadcaster_id
                      ? "Transmitindo agora"
                      : "Na sala"}
                  </span>
                </div>
                {m.user_id === snapshot.room.broadcaster_id && (
                  <Icon name="screen" size={17} />
                )}
                {snapshot.room.created_by === self && m.user_id !== self && (
                  <button
                    className="icon-button"
                    aria-label={`Expulsar ${m.nickname} da sala`}
                    title={`Expulsar ${m.nickname}`}
                    disabled={kicking !== null}
                    onClick={() => void kick(m.user_id)}
                  >
                    <Icon name="removeUser" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {snapshot.members.length < capacity && (
            <div className="empty-seat">
              <span>+</span>Tem lugar para mais {capacity - snapshot.members.length}
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="connection-label">
            <span
              className={`status-dot ${connection !== "Conectado" ? "pending" : ""}`}
            />
            {connection}
          </span>
          <div className="self-row">
            <span className="avatar avatar-self">
              {snapshot.members
                .find((m) => m.user_id === self)
                ?.nickname.slice(0, 2)
                .toUpperCase()}
            </span>
            <strong>
              {snapshot.members.find((m) => m.user_id === self)?.nickname}
            </strong>
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label="Configurações"
            >
              <Icon name="settings" />
            </button>
          </div>
        </div>
      </aside>
      <main className="room-main">
        <header className="room-header">
          <AdminEntry/>
          <span className="p2p-badge">
            <span className="status-dot" />
            WebRTC P2P
          </span>
        </header>
        <div className="stream-heading">
          <div>
            <span className={`stream-indicator ${host ? "live" : ""}`} />
            <strong>
              {host
                ? `${host.nickname} está transmitindo`
                : "Tudo pronto para o próximo jogo"}
            </strong>
            {host && <span className="live-tag">AO VIVO</span>}
          </div>
          <button
            className={`icon-button ${diagnostics ? "active" : ""}`}
            onClick={() => setDiagnostics(!diagnostics)}
            aria-label="Alternar diagnóstico técnico"
            aria-pressed={diagnostics}
          >
            <Icon name="chart" />
          </button>
        </div>
        <div className="stage" ref={stage}>
          {media.remote ? (
            <Player stream={media.remote} volume={volume} onError={setError} />
          ) : (
            <div className="stage-empty">
              <div
                className={`screen-illustration ${media.sharing ? "is-sharing" : ""}`}
              >
                <Icon name="screen" size={46} />
                {media.sharing && <span className="status-dot" />}
              </div>
              {(media.sharing || host) && (
                <>
                  <span className="stage-eyebrow">
                    {media.sharing
                      ? "SEU JOGO ESTÁ AO VIVO"
                      : "CONECTANDO AO JOGO"}
                  </span>
                  <h2>
                    {media.sharing
                      ? "Pode voltar para o jogo."
                      : "Preparando a transmissão…"}
                  </h2>
                  <p>
                    {media.sharing
                      ? `${media.connections} espectador(es) conectado(s). Sem prévia local para poupar recursos.`
                      : "Estabelecendo uma conexão direta e segura com o transmissor."}
                  </p>
                </>
              )}
              {!host && !media.sharing && (
                <button
                  className="primary"
                  onClick={() => void share()}
                  disabled={
                    !ready ||
                    connection !== "Conectado" ||
                    sharingBusy ||
                    !captureSupported()
                  }
                >
                  <Icon name="screen" />
                  {sharingBusy ? "Preparando…" : "Compartilhar jogo"}
                </button>
              )}
              <span className="stage-hint">
                {media.sharing
                  ? "Encerre aqui ou no controle do navegador."
                  : "720p · 30 FPS desejados · áudio quando disponível"}
              </span>
            </div>
          )}
          <div className="stage-caption">
            <span>
              <Icon name="lock" size={13} />
              Mídia entre participantes
            </span>
            <span>
              {media.remote
                ? `${media.status} · ${media.audio}`
                : media.sharing
                  ? "Captura nativa"
                  : "Aguardando transmissão"}
            </span>
          </div>
        </div>
        <div className="control-bar">
          <div className="main-actions">
            {media.sharing ? (
              <button
                className="danger"
                onClick={() => {
                  void session.current?.stop().catch(report);
                }}
              >
                <Icon name="stop" size={17} />
                Parar transmissão
              </button>
            ) : (
              <button
                className="primary"
                disabled={
                  !ready ||
                  connection !== "Conectado" ||
                  !!host ||
                  sharingBusy ||
                  !captureSupported()
                }
                onClick={() => void share()}
              >
                <Icon name="screen" size={18} />
                {sharingBusy ? "Preparando…" : "Compartilhar jogo"}
              </button>
            )}
            <div className="volume">
              <Icon name="sound" size={18} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume da transmissão"
                disabled={!media.remote}
              />
            </div>
          </div>
          <div className="secondary-actions">
            <button
              className="icon-button"
              disabled={!media.remote}
              onClick={() => {
                void stage.current
                  ?.requestFullscreen()
                  .catch(() =>
                    setError("Não foi possível abrir a tela cheia."),
                  );
              }}
              aria-label="Tela cheia"
            >
              <Icon name="full" />
            </button>
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label="Configurações"
            >
              <Icon name="settings" />
            </button>
            <span className="control-divider" />
            <button className="leave-button" onClick={() => void leave()}>
              <Icon name="exit" size={18} />
              <span>Sair da sala</span>
            </button>
          </div>
        </div>
        {error && (
          <div className="error room-message" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dispensar erro"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice room-message" role="status">
            {notice}
          </div>
        )}
        {!captureSupported() && (
          <div className="notice">
            Para compartilhar, use Chrome ou Edge atualizado em HTTPS ou
            localhost.
          </div>
        )}
        {diagnostics && (
          <Diagnostics metrics={metrics} members={snapshot.members} />
        )}
        <div className="room-footnote">
          <Icon name="screen" size={16} />
          <p>
            Mais jogo, menos consumo.
            <span>
              {" "}
              Captura nativa, sem filtros e sem processamento de vídeo em
              JavaScript.
            </span>
          </p>
        </div>
      </main>
      {settings && (
        <Settings
          onClose={() => setSettings(false)}
          diagnostics={diagnostics}
          onDiagnostics={setDiagnostics}
          audio={media.audio}
          connection={connection}
        />
      )}
    </div>
  );
}
