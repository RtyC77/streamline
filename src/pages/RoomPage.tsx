import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Player } from "../components/Player";
import { CameraPreview } from "../components/CameraPreview";
import {TransitionCover} from '../components/TransitionCover';
import { Diagnostics } from "../components/Diagnostics";
import { Settings } from "../components/Settings";
import {ShareOptions} from '../components/ShareOptions';
import { CaptureTest } from "../components/CaptureTest";
import {activeStreams} from '../types';
import {defaultProfile,type CaptureProfile} from '../media/profile';
import { captureGame, captureSupported, type CaptureInfo } from "../media/capture";
import { roomSounds } from "../media/room-sounds";
import { inviteLink } from "../services/rooms";
import { explain } from "../services/errors";
import { RoomSession } from "../services/session";
import type { CameraView, MediaState, PeerMetric, Snapshot, StreamControls } from "../types";
import { ReleaseInfo } from "../components/ReleaseInfo";
const initialMedia: MediaState = {
  sharing: false,
  remote: null,
  audio: "Sem captura ativa",
  connections: 0,
  status: "Aguardando transmissão",
};
interface PendingCapture {
  capture: CaptureInfo;
  controller: RoomSession;
  replacing: boolean;
  requested: CaptureProfile;
}
function disposeCapture(capture: CaptureInfo) {
  capture.dispose?.();
  capture.stream.getTracks().forEach(track => track.stop());
}
export function RoomPage({
  initial,
  self,
  invite,
  onLeave,
  accountActions,
  onLogout,
}: {
  initial: Snapshot;
  self: string;
  invite: string;
  onLeave: (reason?: string) => void;
  accountActions?: ReactNode;
  onLogout?: () => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const streams=activeStreams(snapshot);
  const [posters,setPosters]=useState<Record<string,string>>({});
  const [shareOptions,setShareOptions]=useState(false);
  const [broadcastMenuOpen, setBroadcastMenuOpen] = useState(false);
  const broadcastActions = useRef<HTMLDivElement>(null);
  const broadcastMenuToggle = useRef<HTMLButtonElement>(null);
  const [profile,setProfile]=useState<CaptureProfile>(defaultProfile);
  const freeze=useRef<(()=>void)|null>(null);
  const savePoster=useCallback((session:string,image:string)=>setPosters(previous=>previous[session]===image?previous:{...previous,[session]:image}),[]);
  const streamKey=streams.map(s=>s.session_id).sort().join(',');
  useEffect(()=>{setPosters(previous=>{const next=Object.fromEntries(Object.entries(previous).filter(([id])=>streamKey.split(',').includes(id)));return Object.keys(next).length===Object.keys(previous).length?previous:next;});},[streamKey]);
  const capacity = snapshot.room.max_members ?? 5;
  const [media, setMedia] = useState(initialMedia);
  const [streamControls, setStreamControls] = useState<Record<string, StreamControls>>({});
  const [captureTest, setCaptureTest] = useState<PendingCapture | null>(null);
  const pendingCapture = useRef<PendingCapture | null>(null);
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
  const [viewerEconomy, setViewerEconomy] = useState(false);
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
  const cancelCaptureTest = useCallback(() => {
    const pending = pendingCapture.current;
    if (!pending) return;
    pendingCapture.current = null;
    disposeCapture(pending.capture);
    setCaptureTest(null);
    setSharingBusy(false);
  }, []);
  useEffect(() => {
    const track = captureTest?.capture.stream.getVideoTracks()[0];
    if (!track) return;
    const ended = () => {
      cancelCaptureTest();
      setError("A captura foi encerrada. Escolha uma janela para tentar novamente.");
    };
    if (track.readyState === "ended") { ended(); return; }
    track.addEventListener("ended", ended);
    return () => track.removeEventListener("ended", ended);
  }, [cancelCaptureTest, captureTest]);
  const closeSidebar = () => {
    setSidebarOpen(false);
    sidebarToggle.current?.focus();
  };
  useEffect(() => {
    if (sidebarOpen) sidebarClose.current?.focus();
  }, [sidebarOpen]);
  useEffect(() => {
    if (!media.sharing) setBroadcastMenuOpen(false);
  }, [media.sharing]);
  useEffect(() => {
    if (!broadcastMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !broadcastActions.current?.contains(event.target)) {
        setBroadcastMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [broadcastMenuOpen]);
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
    const sounds = roomSounds(initial, self);
    sounds.unlock();
    window.addEventListener("click", sounds.unlock, true);
    window.addEventListener("keydown", sounds.unlock, true);
    setCameras({});
    setCameraBusy(false);
    setCameraError("");
    const controller = new RoomSession(initial, self, {
      snapshot: (next) => {
        sounds.update(next);
        setSnapshot(next);
      },
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
      streamControls: (sender, next) => setStreamControls(previous => {
        const current = previous[sender];
        return current?.session === next.session && current.paused === next.paused && current.allowMarks === next.allowMarks
          ? previous : { ...previous, [sender]: next };
      }),
    });
    session.current = controller;
    void controller
      .start()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(report);
    const hide = (event: PageTransitionEvent) => {
      session.current = null;
      cancelCaptureTest();
      void controller.close(!event.persisted).catch(() => {});
    };
    window.addEventListener("pagehide", hide);
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload();
    };
    window.addEventListener("pageshow", show);
    return () => {
      cancelled = true;
      window.removeEventListener("click", sounds.unlock, true);
      window.removeEventListener("keydown", sounds.unlock, true);
      sounds.close();
      cancelCaptureTest();
      session.current = null;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      void controller.close();
    };
  }, [initial, self, report, onLeave, savePoster, cancelCaptureTest]);
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
  const controlsFor = (stream: typeof selected) => {
    if (!stream) return;
    if (stream.broadcaster_id === self)
      return { paused: media.paused, allowMarks: media.allowMarks };
    const controls = streamControls[stream.broadcaster_id];
    return controls?.session === stream.session_id ? controls : undefined;
  };
  const selectedControls = controlsFor(selected);
  const selectedPaused = selectedControls?.paused === true;
  const host = snapshot.members.find(
    (m) => m.user_id === selected?.broadcaster_id,
  );
  const finishShare = async ({ capture, controller, replacing, requested }: PendingCapture) => {
    try {
      if (replacing) await controller.replaceCapture(capture);
      else await controller.share(capture);
      if (session.current !== controller) return;
      setProfile(requested);
      const actual = capture.settings;
      setNotice(
        `${capture.audio}. ${capture.tuning}${actual.width && actual.height ? ` Captura retornada: ${actual.width} × ${actual.height}${actual.frameRate ? `, ${actual.frameRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} FPS` : ""}.` : ""}`,
      );
    } catch (error) {
      if (session.current === controller) report(error);
    } finally {
      if (session.current === controller) setSharingBusy(false);
    }
  };
  const share = async (requested: CaptureProfile, test: boolean) => {
    if (sharingBusy) return;
    const controller = session.current;
    const replacing = media.sharing;
    if (!controller) return;
    setSharingBusy(true);
    setShareOptions(false);
    setError("");
    setNotice("");
    try {
      // getDisplayMedia runs immediately within the click gesture, before RPCs.
      const capture = await captureGame(requested);
      if (session.current !== controller) {
        disposeCapture(capture);
        return;
      }
      const pending = { capture, controller, replacing, requested };
      if (test) {
        pendingCapture.current = pending;
        setCaptureTest(pending);
      } else await finishShare(pending);
    } catch (e) {
      if (session.current === controller) {
        report(e);
        setSharingBusy(false);
      }
    }
  };
  const confirmCaptureTest = () => {
    const pending = pendingCapture.current;
    if (!pending) return;
    pendingCapture.current = null;
    setCaptureTest(null);
    void finishShare(pending);
  };
  const changeQuality = async (requested: CaptureProfile) => {
    const controller = session.current;
    if (sharingBusy || !controller) return;
    setShareOptions(false);
    setSharingBusy(true);
    setError("");
    setNotice("");
    try {
      const actual = await controller.changeQuality(requested);
      if (session.current !== controller) return;
      setProfile(requested);
      setNotice(actual.width && actual.height
        ? `Qualidade atualizada. Captura atual: ${actual.width} × ${actual.height}${actual.frameRate ? `, ${actual.frameRate.toLocaleString("pt-BR", {maximumFractionDigits: 1})} FPS` : ""}.`
        : "Resolução e FPS solicitados ao navegador.");
    } catch (error) {
      report(error);
    } finally {
      setSharingBusy(false);
    }
  };
  const saferProfile: CaptureProfile = {
    ...profile,
    resolution: profile.resolution > 720 ? 720 : profile.resolution,
    fps: profile.fps > 30 ? 30 : profile.fps,
  };
  const useEconomy = (enabled: boolean) => {
    setViewerEconomy(enabled);
    session.current?.setViewerEconomy(enabled);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(invite));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(
        "Não foi possível copiar o convite. Verifique a permissão de acesso à área de transferência e tente novamente.",
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
        <button className="secondary invite-copy" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={16} />
          {copied ? "Convite copiado" : "Copiar convite"}
        </button>
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
                    : <span aria-hidden="true">{m.nickname.slice(0, 2).toUpperCase()}</span>}
                </span>
                <div>
                  <div className="participant-name">
                    <strong title={m.nickname}>{m.nickname}</strong>
                    {m.user_id === snapshot.room.created_by && (
                      <span className="participant-crown" role="img" aria-label="Criador da sala" title="Criador da sala">
                        <Icon name="crown" size={14} />
                      </span>
                    )}
                  </div>
                  {cameras[m.user_id]?.message && <span className="camera-message">{cameras[m.user_id].message}</span>}
                </div>
                {streams.some(s=>s.broadcaster_id===m.user_id) && (
                  <span className="participant-sharing" role="img" aria-label="Compartilhando tela" title="Compartilhando tela">
                    <Icon name="screen" size={15} />
                  </span>
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
        </div>
        <div className="sidebar-bottom">
          <div className="self-row">
            <span className="avatar avatar-self">
              {snapshot.members
                .find((m) => m.user_id === self)
                ?.nickname.slice(0, 2)
                .toUpperCase()}
            </span>
            <div className="self-details">
              <strong>
                {snapshot.members.find((m) => m.user_id === self)?.nickname}
              </strong>
              <span className="connection-label">
                <span
                  className={`status-dot ${connection !== "Conectado" ? "pending" : ""}`}
                />
                {connection}
              </span>
            </div>
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label="Configurações"
            >
              <Icon name="settings" />
            </button>
          </div>
          <ReleaseInfo />
        </div>
      </aside>
      <main className="room-main">
        <header className="room-header">
          <h1><Icon name="screen" size={21} /><span>{snapshot.room.name}</span></h1>
          <button ref={sidebarToggle} className="secondary sidebar-toggle"
            aria-expanded={sidebarOpen} aria-controls="room-sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}>
            Detalhes da sala
          </button>
          {(accountActions || onLogout) && <div className="account-actions">
            {accountActions}
            {onLogout && <button type="button" className="account-control account-control--exit" onClick={() => {
              void (session.current?.close(true) ?? Promise.resolve()).catch(() => undefined)
                .finally(() => { onLeave(); onLogout(); });
            }}><Icon name="exit" size={16} /> Sair da conta</button>}
          </div>}
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
                ? selectedPaused ? `${host.nickname} pausou a transmissão` : `${host.nickname} está transmitindo`
                : "Tudo pronto para o próximo jogo"}
            </strong>
            {host && !selectedPaused && <span className="live-tag">AO VIVO</span>}
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
          {streams.map(stream=>{const member=snapshot.members.find(m=>m.user_id===stream.broadcaster_id);const current=stream.session_id===media.selected;const paused=controlsFor(stream)?.paused;return <button key={stream.session_id} className={`stream-tile ${current?'selected':''}`} aria-pressed={current} disabled={media.switching} onClick={()=>{if(!current||media.connectionIssue){freeze.current?.();session.current?.watch(stream.session_id);}setExpanded(true);}}>
            <div className="stream-still">{!paused&&posters[stream.session_id]?<img src={posters[stream.session_id]} alt="Quadro congelado da transmissão"/>:<Icon name="screen" size={28}/>}<span>{paused?'Pausada':current?'Selecionada':posters[stream.session_id]?'Congelada':'Prévia indisponível'}</span></div>
            <strong>{member?.nickname??'Participante'}{stream.broadcaster_id===self?' · você':''}</strong>
          </button>;})}
        </div>}
        <div className={`stage ${streams.length > 0 && !expanded ? 'stage-background' : ''}`} ref={stage}>
          {media.remote ? (
            <Player key={media.selected} stream={media.remote} volume={volume} onError={setError}
              paused={selectedPaused} allowMarks={selectedControls?.allowMarks} mark={media.mark}
              onMark={point => session.current?.markScreen(point)}
              freeze={freeze} poster={media.selected?posters[media.selected]:undefined} onReady={()=>{if(media.selected&&media.remote)session.current?.firstFrame(media.selected,media.remote);}} onStill={image=>{if(media.selected)session.current?.rememberPreview(media.selected,image);}}/>
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
          {!media.remote && selectedPaused && <div className="pause-cover" role="status">Transmissão pausada</div>}
          {!media.remote&&!selectedPaused&&selected&&selected.broadcaster_id!==self&&<TransitionCover poster={posters[selected.session_id]} failed={!media.switching&&!!media.connectionIssue}/>}
        </div>
        <div className="control-bar">
          <div className="main-actions">
            {media.sharing ? (
              <div
                className="broadcast-actions"
                ref={broadcastActions}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setBroadcastMenuOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || !broadcastMenuOpen) return;
                  event.stopPropagation();
                  setBroadcastMenuOpen(false);
                  broadcastMenuToggle.current?.focus();
                }}
              >
                <button type="button" className="danger broadcast-stop" onClick={() => {
                  setBroadcastMenuOpen(false);
                  void session.current?.stop().catch(report);
                }}>
                  <Icon name="stop" size={17} />
                  Parar transmissão
                </button>
                <button
                  type="button"
                  className="secondary broadcast-menu-toggle"
                  ref={broadcastMenuToggle}
                  disabled={sharingBusy}
                  aria-label="Opções da transmissão"
                  aria-expanded={broadcastMenuOpen}
                  aria-controls="broadcast-menu"
                  onClick={() => setBroadcastMenuOpen(open => !open)}
                >
                  Opções
                  <Icon name="chevronDown" size={16} />
                </button>
                <div id="broadcast-menu" className="broadcast-menu" hidden={!broadcastMenuOpen}>
                  <button type="button" onClick={() => {
                    session.current?.setPaused(!media.paused);
                    setBroadcastMenuOpen(false);
                    broadcastMenuToggle.current?.focus();
                  }}>
                    <Icon name={media.paused ? "play" : "pause"} size={17} />
                    {media.paused ? "Retomar transmissão" : "Pausar transmissão"}
                  </button>
                  <button type="button" onClick={() => {
                    setBroadcastMenuOpen(false);
                    broadcastMenuToggle.current?.focus();
                    setShareOptions(true);
                  }}>
                    <Icon name="settings" size={17} />
                    Editar transmissão
                  </button>
                  <button type="button" aria-pressed={media.allowMarks === true}
                    onClick={() => session.current?.setAllowMarks(!media.allowMarks)}>
                    <Icon name="target" size={17} />
                    <span>Permitir marcações dos espectadores</span>
                    {media.allowMarks && <Icon name="check" size={16} />}
                  </button>
                </div>
              </div>
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
            <button
              className="secondary camera-toggle"
              disabled={cameraBusy || (!ready && !cameraOn)}
              onClick={() => void toggleCamera()}
            >
              {cameraBusy ? "Solicitando acesso à câmera…" : cameraOn ? "Desativar câmera" : "Ativar câmera"}
            </button>
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
            <button
              type="button"
              className="secondary viewer-economy"
              aria-pressed={viewerEconomy}
              title="Solicita até 480p, 24 FPS e 800 kbps para as telas que você assiste"
              onClick={() => useEconomy(!viewerEconomy)}
            >
              Modo econômico
            </button>
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
          {connection === "Conectado" && media.suggestEconomy && !selectedPaused && !viewerEconomy && (
            <div className="notice room-message quality-advice">
              <span role="status">A conexão com esta transmissão está lenta ou instável.</span>
              <button className="secondary" type="button" onClick={() => useEconomy(true)}>Ativar modo econômico</button>
            </div>
          )}
          {connection === "Conectado" && media.suggestLowerQuality && !sharingBusy && (
            <div className="notice room-message quality-advice">
              <span role="status">Sua transmissão está sendo limitada pela conexão.</span>
              <button className="secondary" type="button" onClick={() => void changeQuality(saferProfile)}>
                Reduzir para {saferProfile.resolution}p / {saferProfile.fps} FPS
              </button>
            </div>
          )}
          {cameraError && <div className="error room-message" role="alert">{cameraError}</div>}
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
      {shareOptions&&<ShareOptions initial={profile} onClose={()=>setShareOptions(false)} onShare={(requested, test)=>void share(requested, test)} onQuality={media.sharing ? requested=>void changeQuality(requested) : undefined}/>}
      {captureTest && <CaptureTest capture={captureTest.capture} replacing={captureTest.replacing}
        onCancel={cancelCaptureTest} onConfirm={confirmCaptureTest} />}
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
