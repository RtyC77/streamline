import { useCallback, useEffect, useRef, useState } from "react";
import { Brand, Icon } from "../components/Icon";
import { Player } from "../components/Player";
import { CameraPreview } from "../components/CameraPreview";
import {TransitionCover} from '../components/TransitionCover';
import { Diagnostics } from "../components/Diagnostics";
import { Settings } from "../components/Settings";
import {ShareOptions} from '../components/ShareOptions';
import {activeStreams} from '../types';
import {defaultProfile,type CaptureProfile} from '../media/profile';
import { captureGame, captureSupported } from "../media/capture";
import { inviteLink } from "../services/rooms";
import { explain } from "../services/errors";
import { RoomSession } from "../services/session";
import type { CameraView, MediaState, PeerMetric, Snapshot } from "../types";
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
  const streams=activeStreams(snapshot);
  const [posters,setPosters]=useState<Record<string,string>>({});
  const [shareOptions,setShareOptions]=useState(false);
  const [profile,setProfile]=useState<CaptureProfile>(defaultProfile);
  const freeze=useRef<(()=>void)|null>(null);
  const savePoster=useCallback((session:string,image:string)=>setPosters(previous=>previous[session]===image?previous:{...previous,[session]:image}),[]);
  const streamKey=streams.map(s=>s.session_id).sort().join(',');
  useEffect(()=>{setPosters(previous=>{const next=Object.fromEntries(Object.entries(previous).filter(([id])=>streamKey.split(',').includes(id)));return Object.keys(next).length===Object.keys(previous).length?previous:next;});},[streamKey]);
  const capacity = snapshot.room.max_members ?? 5;
  const [media, setMedia] = useState(initialMedia);
  const [cameras, setCameras] = useState<Record<string, CameraView>>({});
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [metrics, setMetrics] = useState<PeerMetric[]>([]);
  const [connection, setConnection] = useState("Conectando");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarClose = useRef<HTMLButtonElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const [connectionNotice, setConnectionNotice] = useState("");
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
  const closeSidebar = () => {
    setSidebarOpen(false);
    sidebarToggle.current?.focus();
  };
  useEffect(() => {
    if (sidebarOpen) sidebarClose.current?.focus();
  }, [sidebarOpen]);
  useEffect(() => {
    if (!media.connectionIssue) return;
    setConnectionNotice(media.connectionIssue);
  }, [media.connectionIssue]);
  useEffect(() => {
    if (!connectionNotice) return;
    const timer = setTimeout(() => setConnectionNotice(""), 10_000);
    return () => clearTimeout(timer);
  }, [connectionNotice]);
  useEffect(() => {
    if (streams.length === 0) setExpanded(false);
  }, [streams.length]);
  useEffect(() => {
    session.current?.setDiagnostics(diagnostics);
  }, [diagnostics]);
  useEffect(() => {
    let cancelled = false;
    setCameras({});
    setCameraBusy(false);
    setCameraError("");
    const controller = new RoomSession(initial, self, {
      snapshot: setSnapshot,
      media: setMedia,
      cameras: setCameras,
      cameraError: setCameraError,
      metrics: setMetrics,
      error: report,
      connection: setConnection,
      expired: (reason) => {
        if (!cancelled) onLeave(reason);
      },
      preview:savePoster,
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
      session.current = null;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      void controller.close();
    };
  }, [initial, self, report, onLeave,savePoster]);
  const cameraOn = !!cameras[self]?.stream;
  const toggleCamera = async () => {
    const controller = session.current;
    if (!controller || cameraBusy) return;
    setCameraError("");
    if (cameraOn) {
      controller.stopCamera();
      return;
    }
    setCameraBusy(true);
    try {
      await controller.startCamera();
    } catch (cause) {
      if (session.current === controller) setCameraError(explain(cause));
    } finally {
      if (session.current === controller) setCameraBusy(false);
    }
  };
  const selected=streams.find(s=>s.session_id===media.selected);
  const host = snapshot.members.find(
    (m) => m.user_id === selected?.broadcaster_id,
  );
  const share = async (requested:CaptureProfile) => {
    if (sharingBusy) return;
    setSharingBusy(true);
    setError("");
    setNotice("");
    try {
      // getDisplayMedia runs immediately within the click gesture, before RPCs.
      const capture = await captureGame(requested);
      setProfile(requested);setShareOptions(false);
      if (!session.current) {
        capture.dispose?.();
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
      <aside id="room-sidebar" className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && sidebarOpen) closeSidebar();
        }}>
        <button ref={sidebarClose} className="secondary sidebar-close" onClick={closeSidebar}>
          Fechar detalhes
        </button>
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
                <span className={`avatar avatar-${i % 4}${cameras[m.user_id]?.stream ? " camera-avatar" : ""}`}>
                  {cameras[m.user_id]?.stream
                    ? <CameraPreview stream={cameras[m.user_id].stream!} name={m.nickname} />
                    : m.nickname.slice(0, 2).toUpperCase()}
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
                    {streams.some(s=>s.broadcaster_id===m.user_id)
                      ? "Transmitindo agora"
                      : "Na sala"}
                  </span>
                  {cameras[m.user_id]?.message && <span className="camera-message">{cameras[m.user_id].message}</span>}
                </div>
                {streams.some(s=>s.broadcaster_id===m.user_id) && (
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
          <button className="secondary wide camera-toggle" disabled={cameraBusy || (!ready && !cameraOn)} onClick={() => void toggleCamera()}>
            {cameraBusy ? "Solicitando acesso à câmera…" : cameraOn ? "Desativar câmera" : "Ativar câmera"}
          </button>
          {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
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
          <button ref={sidebarToggle} className="secondary sidebar-toggle"
            aria-expanded={sidebarOpen} aria-controls="room-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}>
            Detalhes da sala
          </button>
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
        {expanded && streams.length > 0 && <button className="secondary back-to-grid" onClick={() => setExpanded(false)}>Voltar</button>}
        {streams.length>0&&!expanded&&<div className="stream-picker" aria-label="Telas compartilhadas" aria-busy={media.switching===true}>
          {streams.map(stream=>{const member=snapshot.members.find(m=>m.user_id===stream.broadcaster_id);const current=stream.session_id===media.selected;return <button key={stream.session_id} className={`stream-tile ${current?'selected':''}`} aria-pressed={current} disabled={media.switching} onClick={()=>{if(!current||media.connectionIssue){freeze.current?.();session.current?.watch(stream.session_id);}setExpanded(true);}}>
            <div className="stream-still">{posters[stream.session_id]?<img src={posters[stream.session_id]} alt="Quadro congelado da transmissão"/>:<Icon name="screen" size={28}/>}<span>{current?'Selecionada':posters[stream.session_id]?'Congelada':'Prévia indisponível'}</span></div>
            <strong>{member?.nickname??'Participante'}{stream.broadcaster_id===self?' · você':''}</strong>
          </button>;})}
        </div>}
        <div className={`stage ${streams.length > 0 && !expanded ? 'stage-background' : ''}`} ref={stage}>
          {media.remote ? (
            <Player key={media.selected} stream={media.remote} volume={volume} onError={setError} freeze={freeze} poster={media.selected?posters[media.selected]:undefined} onReady={()=>{if(media.selected&&media.remote)session.current?.firstFrame(media.selected,media.remote);}} onStill={image=>{if(media.selected)session.current?.rememberPreview(media.selected,image);}}/>
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
                    {selected?.broadcaster_id===self
                      ? "SEU JOGO ESTÁ AO VIVO"
                      : "CONECTANDO AO JOGO"}
                  </span>
                  <h2>
                    {selected?.broadcaster_id===self
                      ? "Pode voltar para o jogo."
                      : "Preparando a transmissão…"}
                  </h2>
                  <p>
                    {selected?.broadcaster_id===self
                      ? `${media.connections} espectador(es) conectado(s). Sem prévia local para poupar recursos.`
                      : "Estabelecendo uma conexão direta e segura com o transmissor."}
                  </p>
                </>
              )}
              {!host && !media.sharing && streams.length<3 && (
                <button
                  className="primary"
                  onClick={() => setShareOptions(true)}
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
                  : "Escolha uma tela para assistir · até 3 compartilhamentos"}
              </span>
            </div>
          )}
          {!media.remote&&selected&&selected.broadcaster_id!==self&&<TransitionCover poster={posters[selected.session_id]} failed={!media.switching&&!!media.connectionIssue}/>}
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
                  streams.length>=3 ||
                  sharingBusy ||
                  !captureSupported()
                }
                onClick={() => setShareOptions(true)}
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
            <button className="leave-button" aria-label="Sair da sala" onClick={() => void leave()}>
              <Icon name="exit" size={18} />
              <span>Sair da sala</span>
            </button>
          </div>
        </div>
        {(connection === "Reconectando" || connection === "Conexão interrompida") ? (
          <div className="notice connection-toast" role="alert">
            A conexão com a sala foi interrompida. Tentando reconectar.
          </div>
        ) : connectionNotice && (
          <div className="notice connection-toast" role="alert">{connectionNotice}</div>
        )}
        <div className="room-details">
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
            <Diagnostics metrics={metrics} members={snapshot.members} switchTiming={media.switchTiming}/>
          )}
          <div className="room-footnote">
            <Icon name="screen" size={16} />
            <p>
              Mais jogo, menos consumo.
              <span>
                {" "}
                Uma tela ao vivo por vez. As demais usam apenas imagens congeladas.
              </span>
            </p>
          </div>
        </div>
      </main>
      {shareOptions&&<ShareOptions initial={profile} onClose={()=>setShareOptions(false)} onShare={requested=>void share(requested)}/>}
      {settings && (
        <Settings
          onClose={() => setSettings(false)}
          diagnostics={diagnostics}
          onDiagnostics={setDiagnostics}
          audio={media.sharing?(media.captureAudio??media.audio):media.audio}
          connection={connection}
          profile={profile}
        />
      )}
    </div>
  );
}
