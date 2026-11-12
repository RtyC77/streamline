import type { CaptureInfo } from "../media/capture";
import {defaultProfile,type CaptureProfile} from '../media/profile';
import {firstStill} from '../media/still';
import { Peers } from "../media/peers";
import { Cameras } from "../media/cameras";
import type { CameraView, MediaState, PeerMetric, Snapshot } from "../types";
import {activeStreams} from '../types';
import { claimStream, leaveRoom, pulse, releaseStream, tabId } from "./rooms";
import { kickMember } from "./rooms";
import { Signaling } from "./signaling";
import { iceConfiguration } from "./supabase";
import { cadence, sameSnapshot } from "./performance";
import {
  BackgroundTimeout,
  BACKGROUND_LEAVE_MESSAGE,
} from "./background-timeout";
export interface SessionCallbacks {
  preview?: (session:string,image:string)=>void;
  snapshot: (s: Snapshot) => void;
  media: (m: MediaState) => void;
  metrics: (m: PeerMetric[]) => void;
  error: (e: unknown) => void;
  connection: (s: string) => void;
  expired?: (message: string) => void;
  cameras?: (views: Record<string, CameraView>) => void;
  cameraError?: (message: string) => void;
}
export class RoomSession {
  private signaling: Signaling | null = null;
  private peers: Peers | null = null;
  private cameras: Cameras | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPulseAt = 0;
  private lastStatsAt = 0;
  private failures = 0;
  private interrupted = false;
  private applied = false;
  private busy = false;
  private closed = false;
  private connected = false;
  private viewerEconomy?: boolean;
  private lastPulse = Date.now();
  private session: string | null = null;
  private online = new Set<string>();
  private starting = false;
  private captureCleanup:(()=>void)|null=null;
  private stopCapture(){const cleanup=this.captureCleanup;this.captureCleanup=null;cleanup?.();this.peers?.stopLocal();}
  private iceRefreshed = Date.now();
  private diagnostics = false;
  private background: BackgroundTimeout | null = null;
  private operations: Promise<void> = Promise.resolve();
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation);
    this.operations = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  setDiagnostics(enabled: boolean) {
    this.diagnostics = enabled;
  }
  constructor(
    private state: Snapshot,
    private self: string,
    private callbacks: SessionCallbacks,
  ) {}
  async start() {
    const config = await iceConfiguration(this.state.room.id);
    if (this.closed) return;
    if (typeof document !== "undefined")
      this.background = new BackgroundTimeout(
        document,
        () => this.session !== null || this.starting || this.cameras?.capturing === true,
        () => {
          this.callbacks.connection("Saindo por inatividade");
          void this.close(true)
            .catch(() => undefined)
            .finally(() => {
              this.callbacks.expired?.(BACKGROUND_LEAVE_MESSAGE);
            });
        },
      );
    this.peers = new Peers(
      this.self,
      tabId(),
      config,
      (s) => this.signaling!.send(s),
      this.callbacks.media,
      (metrics) => {
        if (this.diagnostics) this.callbacks.metrics(metrics);
      },
      this.callbacks.error,
      (session,image)=>this.callbacks.preview?.(session,image),
    );
    this.cameras = new Cameras(
      this.self,
      tabId(),
      config,
      (signal) => this.signaling!.send(signal),
      (session) => {
        this.signaling?.setCamera(session);
        this.background?.refresh();
      },
      (views) => this.callbacks.cameras?.(views),
      (message) => this.callbacks.cameraError?.(message),
    );
    this.signaling = new Signaling(
      this.state.room.id,
      this.self,
      (id, s) => {
        if (s.media === "camera") this.cameras?.receive(id, s);
        else this.peers?.receive(id, s);
      },
      (id, online) => {
        if (online) this.online.add(id);
        else if (this.online.delete(id)) {
          this.peers?.departed(id);
          this.cameras?.remove(id);
        }
      },
      (ready) => {
        this.connected = ready;
        if (ready && this.viewerEconomy !== undefined) this.peers?.setEconomy(this.viewerEconomy);
        this.cameras?.setConnected(ready);
        this.callbacks.connection(ready ? "Conectado" : "Reconectando");
        if (ready) void this.tick();
      },
      this.callbacks.error,
      () => {
        this.nextPulseAt = Math.min(this.nextPulseAt, Date.now() + 1000);
      },
      (id, session, clientId) => this.cameras?.presence(id, session, clientId),
      (success) => this.cameras?.publication(success),
    );
    await this.enqueue(async () => {
      if (this.closed) return;
      try {
        // Admission already returned an authorized snapshot and renewed membership.
        // Revalidate only if setup (for example TURN) took long enough to stale it.
        let state = this.state;
        if (Date.now() - this.lastPulse >= 10_000) {
          state = await pulse(this.state.room.id, this.session);
          this.lastPulse = Date.now();
        }
        await this.apply(state);
      } catch (error) {
        if (this.closed) return;
        this.callbacks.error(error);
        this.callbacks.connection("Reconectando");
        await this.apply(this.state);
      }
    });
    if (this.closed) return;
    this.nextPulseAt = Date.now() + cadence.viewerPulse;
    this.timer = setInterval(() => {
      if (this.background?.refresh()) return;
      const now = Date.now();
      if (now >= this.nextPulseAt) void this.tick();
      if (
        !this.interrupted &&
        now - this.lastPulse > (this.session ? 30_000 : 55_000)
      ) {
        this.interrupted = true;
        this.stopCapture();
        if (this.cameras?.capturing) {
          this.cameras.stop();
          this.callbacks.cameraError?.("A câmera foi desligada porque a conexão com a sala foi interrompida.");
        }
        this.session = null;
        this.callbacks.connection("Conexão interrompida");
      }
      if (this.connected) {
        void this.peers?.maintain().catch(this.callbacks.error);
        this.cameras?.maintain();
        void this.signaling?.publishCamera();
      }
      if (
        now - this.lastStatsAt >=
        (this.diagnostics ? cadence.diagnostics : cadence.adaptation)
      ) {
        this.lastStatsAt = now;
        void this.peers?.sample(this.diagnostics);
      }
    }, cadence.maintenance);
    window.addEventListener("online", this.onOnline);
  }
  private onOnline = () => {
    void this.tick(true);
  };
  private async apply(state: Snapshot) {
    if (this.closed) return;
    if(this.session&&!activeStreams(state).some(s=>s.broadcaster_id===this.self&&s.session_id===this.session)){
      this.session=null;this.stopCapture();this.background?.refresh();
    }
    if (this.applied && sameSnapshot(this.state, state)) return;
    this.applied = true;
    const epochChanged = this.state.room.channel_epoch !== state.room.channel_epoch;
    this.state = state;
    this.callbacks.snapshot(state);
    this.peers?.setSnapshot(state);
    this.cameras?.setMembers(state.members, epochChanged);
    await this.signaling?.sync(state.members, state.room.channel_epoch);
    if (this.connected) await this.peers?.maintain();
  }
  private async tick(force = false) {
    if (this.background?.refresh()) return;
    if (this.closed || this.busy) return;
    if (!force && Date.now() - this.lastPulse < 1000) return;
    this.busy = true;
    try {
      await this.enqueue(async () => {
        if (this.closed) return;
        if (this.background?.refresh()) return;
        const state = await pulse(this.state.room.id, this.session);
        if (this.closed) return;
        this.lastPulse = Date.now();
        this.failures = 0;
        this.interrupted = false;
        await this.apply(state);
        if (
          import.meta.env.VITE_TURN_FUNCTION &&
          Date.now() - this.iceRefreshed > 20 * 60_000
        ) {
          const config = await iceConfiguration(this.state.room.id);
          this.peers?.configure(config);
          this.cameras?.configure(config);
          this.iceRefreshed = Date.now();
        }
        this.callbacks.connection(
          this.connected ? "Conectado" : "Reconectando",
        );
      });
    } catch (e) {
      if (this.closed) return;
      const message =
        e && typeof e === "object" && "message" in e ? String(e.message) : "";
      if (/Sua participação expirou|A sala expirou/.test(message)) {
        void this.close()
          .catch(() => undefined)
          .finally(() =>
            this.callbacks.expired?.(
              "Sua participação foi encerrada pelo host ou expirou. Entre novamente pelo convite se desejar voltar.",
            ),
          );
        return;
      }
      this.callbacks.connection("Reconectando");
      this.callbacks.error(e);
      this.failures++;
    } finally {
      this.nextPulseAt =
        Date.now() +
        (this.failures
          ? Math.min(30_000, 5_000 * 2 ** Math.min(this.failures - 1, 3))
          : this.session
            ? cadence.senderPulse
            : cadence.viewerPulse);
      this.busy = false;
    }
  }
  async share(capture: CaptureInfo) {
    if (this.closed || this.starting) {
      capture.dispose?.();
      capture.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.starting = true;
    this.background?.refresh();
    let claimed: string | null = null;
    try {
      const poster=await firstStill(capture.stream);
      await this.enqueue(async () => {
        if (this.closed || !this.peers || !this.connected)
          throw new Error(
            "Aguarde a conexão com a sala antes de compartilhar.",
          );
        claimed = await claimStream(this.state.room.id);
        if (
          this.closed ||
          capture.stream.getVideoTracks()[0]?.readyState !== "live"
        )
          throw new Error(
            "A captura foi encerrada. Tente compartilhar novamente.",
          );
        this.session = claimed;
        this.nextPulseAt = Date.now() + cadence.senderPulse;
        const state = await pulse(this.state.room.id, claimed);
        this.lastPulse = Date.now();
        this.interrupted = false;
        await this.apply(state);
        if (
          this.closed ||
          capture.stream.getVideoTracks()[0]?.readyState !== "live"
        )
          throw new Error("A sala ou a captura foi encerrada.");
        this.captureCleanup=capture.dispose??null;
        this.peers?.setLocal(capture.stream, claimed, capture.audio,capture.profile,poster);
        this.watchCaptureEnd(capture.stream.getVideoTracks()[0]);
        void this.signaling?.notifyChange().catch(this.callbacks.error);
      });
    } catch (e) {
      capture.dispose?.();this.captureCleanup=null;
      capture.stream.getTracks().forEach((t) => t.stop());
      if (claimed) {
        const failedSession = claimed;
        await this.enqueue(() =>
          releaseStream(this.state.room.id, failedSession),
        ).catch(() => undefined);
      }
      this.session = null;
      throw e;
    } finally {
      this.starting = false;
      this.background?.refresh();
    }
  }
  private watchCaptureEnd(video: MediaStreamTrack) {
    video.addEventListener("ended", () => {
      if (this.peers?.ownsTrack(video)) void this.stop().catch(this.callbacks.error);
    }, { once: true });
  }
  async changeQuality(profile: CaptureProfile) {
    const session = this.session;
    return this.enqueue(async () => {
      if (!session || session !== this.session || this.closed || !this.peers)
        throw new Error("A transmissão foi encerrada.");
      return this.peers.changeQuality(profile);
    });
  }
  async replaceCapture(capture: CaptureInfo) {
    const session = this.session;
    try {
      const poster = await firstStill(capture.stream);
      await this.enqueue(async () => {
        if (!session || session !== this.session || this.closed || !this.peers)
          throw new Error("A transmissão foi encerrada.");
        const previousCleanup = this.captureCleanup;
        await this.peers.replaceLocal(capture.stream, capture.audio, capture.profile ?? defaultProfile, poster);
        const video = capture.stream.getVideoTracks()[0];
        if (this.closed || session !== this.session || !this.peers?.ownsTrack(video))
          throw new Error("A transmissão foi encerrada.");
        this.captureCleanup = capture.dispose ?? null;
        this.watchCaptureEnd(video);
        previousCleanup?.();
        if (video.readyState !== "live") void this.stop().catch(this.callbacks.error);
      });
    } catch (error) {
      capture.dispose?.();
      capture.stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }
  async stop() {
    const session = this.session;
    this.session = null;
    this.background?.refresh();
    this.stopCapture();
    if (session)
      await this.enqueue(() => releaseStream(this.state.room.id, session));
    void this.signaling?.notifyChange().catch(this.callbacks.error);
    if (!this.closed) await this.tick(true);
  }
  async startCamera() {
    if (this.closed || !this.cameras)
      throw new Error("Aguarde a conexão com a sala para ativar a câmera.");
    await this.cameras.start();
  }
  stopCamera() {
    this.cameras?.stop();
  }
  watch(session:string){
    if(this.closed||!this.connected)return false;
    return this.peers?.requestSelect(session)??false;
  }
  setViewerEconomy(enabled: boolean) {
    this.viewerEconomy = enabled;
    this.peers?.setEconomy(enabled);
    if (this.connected) void this.peers?.maintain().catch(this.callbacks.error);
  }
  firstFrame(session:string,stream:MediaStream){if(!this.closed)this.peers?.firstFrame(session,stream);}
  rememberPreview(session:string,image:string){this.peers?.rememberPreview(session);this.callbacks.preview?.(session,image);}
  async kick(user: string) {
    if (this.closed) return;
    await this.enqueue(async () => {
      if (this.closed) return;
      const state = await kickMember(this.state.room.id, user);
      await this.apply(state);
    });
  }
  async close(voluntary = false) {
    this.closed = true;
    const cleanup=this.captureCleanup;this.captureCleanup=null;cleanup?.();
    this.background?.dispose();
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener("online", this.onOnline);
    this.peers?.dispose();
    this.cameras?.dispose();
    await this.signaling?.close();
    if (voluntary) await this.enqueue(() => leaveRoom(this.state.room.id));
  }
}
