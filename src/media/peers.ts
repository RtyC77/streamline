import { target } from "../config";
import type {
  MediaState,
  PeerMetric,
  Signal,
  SignalBody,
  Snapshot,
} from "../types";
import { preferCodecs, tuneSender } from "./capture";
import { collectStats, type Counter } from "./stats";
interface Peer {
  pc: RTCPeerConnection;
  connection: string;
  session: string;
  ice: RTCIceCandidateInit[];
  counters: Map<string, Counter>;
  created: number;
  retries: number;
  restartAt: number;
  bitrate: number;
  negotiating: boolean;
}
export class Peers {
  private peers = new Map<string, Peer>();
  private snapshot: Snapshot | null = null;
  private stream: MediaStream | null = null;
  private localSession: string | null = null;
  private remote: MediaStream | null = null;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private audio = "Sem trilha";
  private statisticsRunning = false;
  constructor(
    private self: string,
    private clientId: string,
    private config: RTCConfiguration,
    private send: (s: Signal) => Promise<void>,
    private update: (s: MediaState) => void,
    private metrics: (m: PeerMetric[]) => void,
    private warn: (e: unknown) => void,
  ) {}
  configure(config: RTCConfiguration) {
    this.config = config;
    for (const p of this.peers.values()) p.pc.setConfiguration(config);
  }
  private emit() {
    this.update({
      sharing: !!this.stream,
      remote: this.remote,
      audio: this.audio,
      connections: [...this.peers.values()].filter(
        (p) => p.pc.connectionState === "connected",
      ).length,
      status: [...this.peers.values()].some(
        (p) =>
          p.pc.connectionState === "failed" ||
          p.pc.connectionState === "disconnected",
      )
        ? "Conexão perdida; tentando novamente"
        : this.remote
          ? "Recebendo transmissão"
          : this.stream
            ? "Transmitindo"
            : "Aguardando transmissão",
    });
  }
  private close(id: string) {
    const p = this.peers.get(id);
    if (p) {
      p.pc.ontrack = null;
      p.pc.onicecandidate = null;
      p.pc.onconnectionstatechange = null;
      p.pc.close();
      this.peers.delete(id);
    }
  }
  private clear() {
    for (const id of this.peers.keys()) this.close(id);
    this.remote?.getTracks().forEach((t) => t.stop());
    this.remote = null;
    this.metrics([]);
  }
  setSnapshot(snapshot: Snapshot) {
    if (this.disposed) return;
    const previous = this.snapshot?.room.stream_session;
    this.snapshot = snapshot;
    if (previous !== snapshot.room.stream_session) this.clear();
    for (const id of this.peers.keys())
      if (!snapshot.members.some((m) => m.user_id === id)) this.close(id);
    if (this.stream && snapshot.room.stream_session !== this.localSession)
      this.stopLocal();
    this.balanceTracks();
    this.emit();
  }
  setLocal(stream: MediaStream, session: string, audio: string) {
    this.clear();
    this.stream = stream;
    this.localSession = session;
    this.audio = audio;
    this.balanceTracks();
    this.emit();
  }
  stopLocal() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.localSession = null;
    this.audio = "Sem trilha";
    this.clear();
    this.emit();
  }
  private balanceTracks() {
    const enabled = this.peers.size > 0;
    this.stream?.getTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }
  private envelope(id: string, p: Peer, body: SignalBody): Signal {
    return {
      ...body,
      to: id,
      session: p.session,
      connection: p.connection,
      client: this.clientId,
    };
  }
  private create(id: string, connection: string, session: string) {
    this.close(id);
    const pc = new RTCPeerConnection(this.config);
    const peer: Peer = {
      pc,
      connection,
      session,
      ice: [],
      counters: new Map(),
      created: Date.now(),
      retries: 0,
      restartAt: 0,
      bitrate: target.bitrate,
      negotiating: false,
    };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        void this.send(
          this.envelope(id, peer, {
            kind: "ice",
            candidate: e.candidate.toJSON(),
          }),
        ).catch(this.warn);
    };
    pc.ontrack = (e) => {
      if (
        this.stream ||
        this.snapshot?.room.broadcaster_id !== id ||
        this.peers.get(id) !== peer
      )
        return;
      this.remote ??= new MediaStream();
      if (!this.remote.getTracks().some((t) => t.id === e.track.id))
        this.remote.addTrack(e.track);
      this.audio = this.remote.getAudioTracks().length
        ? "Trilha de áudio recebida"
        : "Sem trilha de áudio";
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) === peer) this.emit();
    };
    if (this.stream)
      for (const track of this.stream.getTracks())
        pc.addTrack(track, this.stream);
    preferCodecs(pc);
    this.balanceTracks();
    return peer;
  }
  private async offer(id: string, p: Peer, restart = false) {
    if (p.negotiating || p.pc.signalingState !== "stable") return;
    p.negotiating = true;
    try {
      await p.pc.setLocalDescription(
        await p.pc.createOffer({ iceRestart: restart }),
      );
      if (p.pc.localDescription?.sdp)
        await this.send(
          this.envelope(id, p, {
            kind: "offer",
            sdp: p.pc.localDescription.sdp,
          }),
        );
    } finally {
      p.negotiating = false;
    }
  }
  private async drain(p: Peer) {
    for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(c);
  }
  receive(id: string, signal: Signal) {
    // One offerer (the lease owner), serial SDP processing, and connection UUIDs
    // eliminate glare and prevent old answers/candidates from touching new peers.
    this.queue = this.queue
      .then(async () => {
        const snapshot = this.snapshot;
        if (
          this.disposed ||
          !snapshot ||
          signal.session !== snapshot.room.stream_session ||
          !snapshot.members.some(
            (m) => m.user_id === id && m.client_id === signal.client,
          )
        )
          return;
        const host = snapshot.room.broadcaster_id;
        if (signal.kind === "watch") {
          if (
            host !== this.self ||
            !this.stream ||
            signal.session !== this.localSession
          )
            return;
          const existing = this.peers.get(id);
          if (existing?.connection === signal.connection) return;
          const p = this.create(id, signal.connection, signal.session);
          await this.offer(id, p);
          return;
        }
        if (host !== this.self && host !== id) return;
        const p = this.peers.get(id);
        if (!p || p.connection !== signal.connection) return;
        if (signal.kind === "ice") {
          if (p.pc.remoteDescription)
            await p.pc.addIceCandidate(signal.candidate);
          else if (p.ice.length < 64) p.ice.push(signal.candidate);
        } else if (signal.kind === "offer" && id === host && !this.stream) {
          if (p.pc.signalingState !== "stable") return;
          await p.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          await this.drain(p);
          preferCodecs(p.pc);
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          if (p.pc.localDescription?.sdp)
            await this.send(
              this.envelope(id, p, {
                kind: "answer",
                sdp: p.pc.localDescription.sdp,
              }),
            );
        } else if (
          signal.kind === "answer" &&
          host === this.self &&
          p.pc.signalingState === "have-local-offer"
        ) {
          await p.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
          await this.drain(p);
          await Promise.all(
            p.pc
              .getSenders()
              .map((s) =>
                tuneSender(s, p.bitrate).catch(() =>
                  this.warn(
                    new Error(
                      "O navegador não aceitou o limite do encoder. Confira as métricas reais.",
                    ),
                  ),
                ),
              ),
          );
        }
      })
      .catch((e) => {
        if (!this.disposed) this.warn(e);
      });
  }
  async maintain() {
    if (this.disposed || !this.snapshot) return;
    const { broadcaster_id: host, stream_session: session } =
      this.snapshot.room;
    if (host && host !== this.self && session) {
      const p = this.peers.get(host);
      // Retry lost watch/offer messages and rebuild unrecoverable viewer peers.
      if (
        !p ||
        (p.pc.connectionState !== "connected" &&
          Date.now() - p.created > 20_000)
      ) {
        this.remote?.getTracks().forEach((t) => t.stop());
        this.remote = null;
        const next = this.create(host, crypto.randomUUID(), session);
        await this.send(this.envelope(host, next, { kind: "watch" }));
        this.emit();
      }
    }
    if (host === this.self)
      for (const [id, p] of this.peers) {
        if (
          (p.pc.iceConnectionState === "failed" ||
            p.pc.iceConnectionState === "disconnected") &&
          Date.now() - p.restartAt > 10_000
        ) {
          if (p.retries >= 3) {
            this.close(id);
            continue;
          }
          p.restartAt = Date.now();
          p.retries++;
          await this.offer(id, p, true);
        }
      }
    this.balanceTracks();
  }
  departed(id: string) {
    this.close(id);
    if (this.snapshot?.room.broadcaster_id === id) {
      this.remote?.getTracks().forEach((t) => t.stop());
      this.remote = null;
    }
    this.balanceTracks();
    this.emit();
  }
  async sample() {
    if (this.statisticsRunning || this.disposed || this.peers.size === 0)
      return;
    this.statisticsRunning = true;
    try {
      const metrics = await Promise.all(
        [...this.peers].map(async ([id, p]) => {
          const m = await collectStats(p.pc, id, p.counters);
          if (this.stream && p.pc.connectionState === "connected") {
            const congested =
              m.limitation === "bandwidth" || (m.rtt ?? 0) > 0.35;
            const next = congested
              ? Math.max(target.minBitrate, p.bitrate - 250_000)
              : Math.min(target.maxBitrate, p.bitrate + 100_000);
            if (next !== p.bitrate) {
              p.bitrate = next;
              await Promise.all(
                p.pc
                  .getSenders()
                  .map((s) => tuneSender(s, next).catch(() => undefined)),
              );
            }
          }
          return m;
        }),
      );
      if (!this.disposed) this.metrics(metrics);
    } catch {
      /* Stats may disappear as a peer closes. Never log SDP/ICE. */
    } finally {
      this.statisticsRunning = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.stopLocal();
  }
}
