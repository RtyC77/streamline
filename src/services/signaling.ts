import type { RealtimeChannel } from "@supabase/supabase-js";
import { client } from "./supabase";
import type { Member, Signal } from "../types";

export function parseSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (m.media !== undefined && m.media !== "camera") return null;
  if (
    !["to", "session", "connection", "client"].every(
      (k) => typeof m[k] === "string" && /^[a-f0-9-]{36}$/.test(m[k] as string),
    )
  )
    return null;
  if (m.kind === "watch" && (m.preview===undefined||typeof m.preview==='boolean')) return m as Signal;
  if (m.kind === 'unwatch') return m as Signal;
  if (m.kind === 'ice-batch' && Array.isArray(m.candidates) && m.candidates.length>0 && m.candidates.length<=16 && m.candidates.every(candidate=>parseSignal({...m,kind:'ice',candidate})!==null))return m as Signal;
  if (
    (m.kind === "offer" || m.kind === "answer") &&
    typeof m.sdp === "string" &&
    m.sdp.length < 100_000
  )
    return m as Signal;
  if (m.kind === "ice" && m.candidate && typeof m.candidate === "object") {
    const c = m.candidate as Record<string, unknown>;
    if (
      typeof c.candidate === "string" &&
      c.candidate.length < 4096 &&
      (c.sdpMid === null || typeof c.sdpMid === "string") &&
      (c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex))
    )
      return m as Signal;
  }
  return null;
}

export class Signaling {
  private channels = new Map<string, RealtimeChannel>();
  private ready = new Set<string>();
  private closed = false;
  private epoch = "";
  private lastRefresh = 0;
  private camera: string | null = null;
  private cameraPublished = false;
  private selfClient: string | undefined;
  private memberClients = new Map<string, string>();
  private publication = 0;
  private counts = new Map<string, { start: number; count: number }>();
  constructor(
    private room: string,
    private self: string,
    private receive: (sender: string, signal: Signal) => void,
    private presence: (sender: string, online: boolean) => void,
    private status: (ready: boolean) => void,
    private fail: (error: unknown) => void = () => undefined,
    private changed: () => void = () => undefined,
    private cameraChanged: (sender: string, session: string | null, clientId: string | null) => void = () => undefined,
    private cameraPublication: (success: boolean) => void = () => undefined,
  ) {}
  async sync(members: Member[], epoch: string) {
    if (this.closed) return;
    this.selfClient ??= members.find(member => member.user_id === this.self)?.client_id;
    this.memberClients = new Map(members.map(member => [member.user_id, member.client_id]));
    if (this.epoch !== epoch) {
      const wasReady = this.ready.has(this.self);
      this.epoch = epoch;
      const previous = [...this.channels.values()];
      this.channels.clear();
      this.ready.clear();
      if (wasReady) this.status(false);
      await Promise.all(
        previous.map((channel) => client().removeChannel(channel)),
      );
      if (this.closed) return;
    }
    for (const [id, channel] of this.channels)
      if (!members.some((m) => m.user_id === id)) {
        this.channels.delete(id);
        this.ready.delete(id);
        this.counts.delete(id);
        await client().removeChannel(channel);
      }
    for (const member of members) {
      const id = member.user_id;
      const existing = this.channels.get(id);
      if (existing) {
        if (id !== this.self) this.readCamera(id, existing);
        continue;
      }
      const channel = client().channel(
        `room:${this.room}:${this.epoch}:user:${id}`,
        {
          config: {
            private: true,
            broadcast: { ack: true, self: false },
            presence: { key: this.self },
          },
        },
      );
      this.channels.set(id, channel);
      let seenOnline = false;
      channel.on("broadcast", { event: "state-changed" }, () => {
        if (this.closed || this.channels.get(id) !== channel) return;
        if (Date.now() - this.lastRefresh < 1000) return;
        this.lastRefresh = Date.now();
        this.changed();
      });
      channel.on(
        "broadcast",
        { event: "signal" },
        ({ payload }: { payload: unknown }) => {
          if (this.closed || this.channels.get(id) !== channel) return;
          const now = Date.now();
          const count = this.counts.get(id) ?? { start: now, count: 0 };
          if (now - count.start > 10_000) {
            count.start = now;
            count.count = 0;
          }
          this.counts.set(id, count);
          if (++count.count > 300) return;
          // Broadcast reaches all subscribers: skip SDP/ICE validation for other destinations.
          if (!payload || typeof payload !== 'object' || !('to' in payload) || payload.to !== this.self) return;
          const signal = parseSignal(payload);
          if (signal && signal.to === this.self && id !== this.self)
            this.receive(id, signal);
        },
      );
      channel.on("presence", { event: "sync" }, () => {
        if (this.closed || this.channels.get(id) !== channel) return;
        // Only the owner of this topic can publish presence. Ignore payload identity.
        const presence = Object.values(channel.presenceState()).flat();
        const online = presence.length > 0;
        if (online !== seenOnline) this.presence(id, online);
        seenOnline = online;
        if (id !== this.self) this.readCamera(id, channel);
      });
      channel.subscribe((state) => {
        if (this.closed || this.channels.get(id) !== channel) return;
        if (state === "SUBSCRIBED") {
          this.ready.add(id);
          if (id === this.self) {
            this.cameraPublished = false;
            void this.publishCamera();
            this.status(true);
          }
        } else {
          this.ready.delete(id);
          if (id === this.self) this.status(false);
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
            this.fail(
              new Error(
                "Não foi possível conectar ao canal privado. Verifique sua rede, as migrations e as políticas Realtime.",
              ),
            );
        }
      });
    }
  }
  private readCamera(id: string, channel: RealtimeChannel) {
    const clientId = this.memberClients.get(id);
    const presence = Object.values(channel.presenceState<{ camera?: string; client?: string }>()).flat();
    const current = presence.reverse().find(item => item.client === clientId);
    const camera = current?.camera;
    this.cameraChanged(id, typeof camera === "string" && /^[a-f0-9-]{36}$/.test(camera) ? camera : null, current?.client ?? null);
  }
  setCamera(session: string | null) {
    this.camera = session;
    this.cameraPublished = false;
    void this.publishCamera();
  }
  async publishCamera() {
    const channel = this.channels.get(this.self);
    if (!channel || !this.ready.has(this.self) || this.closed || this.cameraPublished) return;
    const camera = this.camera;
    const publication = ++this.publication;
    this.cameraPublished = true;
    let success = false;
    try {
      success = (await channel.track({ online: true, camera, client: this.selfClient })) === "ok";
    } catch {
      // Maintenance retries publication after an interrupted connection.
    }
    if (this.closed || this.channels.get(this.self) !== channel || this.publication !== publication || this.camera !== camera) return;
    this.cameraPublished = success;
    this.cameraPublication(success);
  }
  async send(signal: Signal) {
    const channel = this.channels.get(this.self);
    if (!channel || !this.ready.has(this.self) || this.closed) return;
    if (
      (await channel.send({
        type: "broadcast",
        event: "signal",
        payload: signal,
      })) !== "ok"
    )
      throw new Error("A sinalização foi interrompida. Reconectando…");
  }
  async notifyChange() {
    const channel = this.channels.get(this.self);
    if (!channel || !this.ready.has(this.self) || this.closed) return;
    if (
      (await channel.send({
        type: "broadcast",
        event: "state-changed",
        payload: {},
      })) !== "ok"
    )
      throw new Error("A atualização da sala será retomada pelo heartbeat.");
  }
  async close() {
    this.closed = true;
    const channels = [...this.channels.values()];
    this.channels.clear();
    this.ready.clear();
    this.counts.clear();
    await Promise.all(channels.map((c) => client().removeChannel(c)));
    const remaining = client().getChannels();
    if (
      remaining.length > 0 &&
      remaining.every((channel) => channels.includes(channel))
    ) {
      await client().removeAllChannels();
    } else if (remaining.length === 0) await client().realtime.disconnect();
  }
}
