import type { RealtimeChannel } from "@supabase/supabase-js";
import { client } from "./supabase";
import type { Member, Signal } from "../types";

export function parseSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (
    !["to", "session", "connection", "client"].every(
      (k) => typeof m[k] === "string" && /^[a-f0-9-]{36}$/.test(m[k] as string),
    )
  )
    return null;
  if (m.kind === "watch") return m as Signal;
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
  private counts = new Map<string, { start: number; count: number }>();
  constructor(
    private room: string,
    private self: string,
    private receive: (sender: string, signal: Signal) => void,
    private presence: (sender: string, online: boolean) => void,
    private status: (ready: boolean) => void,
    private fail: (error: unknown) => void = () => undefined,
    private changed: () => void = () => undefined,
  ) {}
  async sync(members: Member[], epoch: string) {
    if (this.closed) return;
    if (this.epoch !== epoch) {
      this.epoch = epoch;
      const previous = [...this.channels.values()];
      this.channels.clear();
      this.ready.clear();
      this.status(false);
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
      if (this.channels.has(id)) continue;
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
        const online = Object.values(channel.presenceState()).some(
          (values) => values.length > 0,
        );
        if (online !== seenOnline) this.presence(id, online);
        seenOnline = online;
      });
      channel.subscribe((state) => {
        if (this.closed || this.channels.get(id) !== channel) return;
        if (state === "SUBSCRIBED") {
          this.ready.add(id);
          if (id === this.self) {
            void channel.track({ online: true });
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
