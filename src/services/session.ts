import type { CaptureInfo } from "../media/capture";
import { Peers } from "../media/peers";
import type { MediaState, PeerMetric, Snapshot } from "../types";
import { claimStream, leaveRoom, pulse, releaseStream, tabId } from "./rooms";
import { Signaling } from "./signaling";
import { iceConfiguration } from "./supabase";
export interface SessionCallbacks {
  snapshot: (s: Snapshot) => void;
  media: (m: MediaState) => void;
  metrics: (m: PeerMetric[]) => void;
  error: (e: unknown) => void;
  connection: (s: string) => void;
}
export class RoomSession {
  private signaling: Signaling | null = null;
  private peers: Peers | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampling: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private closed = false;
  private connected = false;
  private lastPulse = Date.now();
  private session: string | null = null;
  private online = new Set<string>();
  private starting = false;
  private iceRefreshed = Date.now();
  private diagnostics = false;
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
    );
    this.signaling = new Signaling(
      this.state.room.id,
      this.self,
      (id, s) => this.peers?.receive(id, s),
      (id, online) => {
        if (online) this.online.add(id);
        else if (this.online.delete(id)) this.peers?.departed(id);
      },
      (ready) => {
        this.connected = ready;
        this.callbacks.connection(ready ? "Conectado" : "Reconectando");
        if (ready) void this.tick();
      },
      this.callbacks.error,
      () => {
        void this.tick();
      },
    );
    await this.enqueue(async () => {
      if (this.closed) return;
      try {
        const state = await pulse(this.state.room.id, this.session);
        this.lastPulse = Date.now();
        await this.apply(state);
      } catch (error) {
        if (this.closed) return;
        this.callbacks.error(error);
        this.callbacks.connection("Reconectando");
        await this.apply(this.state);
      }
    });
    if (this.closed) return;
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.sampling = setInterval(() => {
      if (Date.now() - this.lastPulse > 25_000) {
        this.peers?.stopLocal();
        this.session = null;
        this.callbacks.connection("Conexão interrompida");
      }
      void this.peers?.sample();
    }, 5000);
    window.addEventListener("online", this.onOnline);
  }
  private onOnline = () => {
    void this.tick();
  };
  private async apply(state: Snapshot) {
    if (this.closed) return;
    this.state = state;
    this.callbacks.snapshot(state);
    this.peers?.setSnapshot(state);
    await this.signaling?.sync(state.members, state.room.channel_epoch);
    if (this.connected) await this.peers?.maintain();
  }
  private async tick() {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      await this.enqueue(async () => {
        if (this.closed) return;
        const state = await pulse(this.state.room.id, this.session);
        if (this.closed) return;
        this.lastPulse = Date.now();
        await this.apply(state);
        if (
          import.meta.env.VITE_TURN_FUNCTION &&
          Date.now() - this.iceRefreshed > 20 * 60_000
        ) {
          this.peers?.configure(await iceConfiguration(this.state.room.id));
          this.iceRefreshed = Date.now();
        }
        this.callbacks.connection(
          this.connected ? "Conectado" : "Reconectando",
        );
      });
    } catch (e) {
      if (this.closed) return;
      this.callbacks.connection("Reconectando");
      this.callbacks.error(e);
    } finally {
      this.busy = false;
    }
  }
  async share(capture: CaptureInfo) {
    if (this.closed || this.starting) {
      capture.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.starting = true;
    let claimed: string | null = null;
    try {
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
        const state = await pulse(this.state.room.id, claimed);
        await this.apply(state);
        if (
          this.closed ||
          capture.stream.getVideoTracks()[0]?.readyState !== "live"
        )
          throw new Error("A sala ou a captura foi encerrada.");
        this.peers?.setLocal(capture.stream, claimed, capture.audio);
        capture.stream.getVideoTracks()[0].addEventListener(
          "ended",
          () => {
            void this.stop().catch(this.callbacks.error);
          },
          { once: true },
        );
        void this.signaling?.notifyChange().catch(this.callbacks.error);
      });
    } catch (e) {
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
    }
  }
  async stop() {
    const session = this.session;
    this.session = null;
    this.peers?.stopLocal();
    if (session)
      await this.enqueue(() => releaseStream(this.state.room.id, session));
    void this.signaling?.notifyChange().catch(this.callbacks.error);
    if (!this.closed) await this.tick();
  }
  async close(voluntary = false) {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.sampling) clearInterval(this.sampling);
    window.removeEventListener("online", this.onOnline);
    this.peers?.dispose();
    await this.signaling?.close();
    if (voluntary) await this.enqueue(() => leaveRoom(this.state.room.id));
  }
}
