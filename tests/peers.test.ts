import { beforeEach, describe, it, expect, vi } from "vitest";
import { Peers } from "../src/media/peers";
import type { MediaState, Signal, Snapshot } from "../src/types";
const host = crypto.randomUUID(),
  viewer = crypto.randomUUID(),
  hc = crypto.randomUUID(),
  vc = crypto.randomUUID(),
  sid = crypto.randomUUID();
class FakeStream {
  tracks: FakeTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
}
class FakeTrack {
  id = crypto.randomUUID();
  kind = "video";
  readyState = "live";
  enabled = true;
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  getSettings() {
    return { width: 1920, height: 1080 };
  }
}
class FakePC {
  static all: FakePC[] = [];
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((e: unknown) => void) | null = null;
  ontrack: ((e: { track: FakeTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  added: FakeTrack[] = [];
  closed = false;
  getTransceivers() {
    return [];
  }
  getReceivers() {
    return [];
  }
  getSenders() {
    return [];
  }
  constructor() {
    FakePC.all.push(this);
  }
  addTrack(t: FakeTrack) {
    this.added.push(t);
  }
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer" }));
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
  }
  addIceCandidate = vi.fn(async () => undefined);
  close() {
    this.closed = true;
    this.signalingState = "closed";
  }
  async getStats() {
    return new Map();
  }
}
const snapshot: Snapshot = {
  room: {
    channel_epoch: crypto.randomUUID(),
    id: crypto.randomUUID(),
    name: "Sala",
    expires_at: "2099-01-01",
    broadcaster_id: host,
    stream_session: sid,
  },
  members: [
    { user_id: host, nickname: "Host", client_id: hc },
    { user_id: viewer, nickname: "Viewer", client_id: vc },
  ],
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function setup(self: string, client: string) {
  const messages: Signal[] = [];
  const states: MediaState[] = [];
  const warn = vi.fn();
  const manager = new Peers(
    self,
    client,
    {},
    async (s) => {
      messages.push(s);
    },
    (s) => states.push(s),
    () => undefined,
    warn,
  );
  manager.setSnapshot(snapshot);
  return { manager, messages, states, warn };
}
beforeEach(() => {
  FakePC.all = [];
  vi.stubGlobal("RTCPeerConnection", FakePC);
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => null });
});
describe("Negociação por espectador", () => {
  it("negocia offer/answer, enfileira ICE precoce e ignora mensagens antigas", async () => {
    const h = setup(host, hc),
      v = setup(viewer, vc);
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    expect(track.enabled).toBe(false);
    await v.manager.maintain();
    const watch = v.messages[0];
    h.manager.receive(viewer, watch);
    await flush();
    expect(h.messages[0].kind).toBe("offer");
    expect(track.enabled).toBe(true);
    const offer = h.messages[0];
    const ice: Signal = {
      ...offer,
      kind: "ice",
      candidate: { candidate: "candidate:x", sdpMid: "0", sdpMLineIndex: 0 },
    };
    v.manager.receive(host, ice);
    v.manager.receive(host, { ...offer, session: crypto.randomUUID() });
    await flush();
    expect(FakePC.all[0].remoteDescription).toBeNull();
    v.manager.receive(host, offer);
    await flush();
    expect(FakePC.all[0].addIceCandidate).toHaveBeenCalledTimes(1);
    h.manager.receive(
      viewer,
      v.messages.find((s) => s.kind === "answer")!,
    );
    await flush();
    expect(FakePC.all[1].signalingState).toBe("stable");
    expect(h.warn).not.toHaveBeenCalled();
    expect(v.warn).not.toHaveBeenCalled();
    h.manager.dispose();
    v.manager.dispose();
    expect(track.stop).toHaveBeenCalled();
    expect(FakePC.all.every((p) => p.closed)).toBe(true);
  });
  it("não cria conexões duplicadas para watch repetido e rejeita client_id forjado", async () => {
    const h = setup(host, hc);
    const stream = new FakeStream();
    stream.addTrack(new FakeTrack());
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    const watch: Signal = {
      kind: "watch",
      to: host,
      session: sid,
      connection: crypto.randomUUID(),
      client: vc,
    };
    h.manager.receive(viewer, { ...watch, client: crypto.randomUUID() });
    await flush();
    expect(FakePC.all).toHaveLength(0);
    h.manager.receive(viewer, watch);
    h.manager.receive(viewer, watch);
    await flush();
    expect(FakePC.all).toHaveLength(1);
    expect(h.messages).toHaveLength(1);
    h.manager.dispose();
  });
  it("aceita espectador tardio, fecha conexão anterior e descarta candidates de outra conexão", async () => {
    const v = setup(viewer, vc);
    await v.manager.maintain();
    const old = v.messages[0];
    v.manager.receive(host, {
      ...old,
      to: viewer,
      client: hc,
      connection: crypto.randomUUID(),
      kind: "ice",
      candidate: { candidate: "x", sdpMid: "0", sdpMLineIndex: 0 },
    });
    await flush();
    expect(FakePC.all[0].addIceCandidate).not.toHaveBeenCalled();
    v.manager.setSnapshot({
      ...snapshot,
      room: { ...snapshot.room, stream_session: crypto.randomUUID() },
    });
    expect(FakePC.all[0].closed).toBe(true);
    await v.manager.maintain();
    expect(FakePC.all).toHaveLength(2);
    v.manager.dispose();
  });
  it("interrompe captura quando perde a concessão e libera peers na saída", () => {
    const h = setup(host, hc);
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    h.manager.setSnapshot({
      ...snapshot,
      room: { ...snapshot.room, broadcaster_id: null, stream_session: null },
    });
    expect(track.readyState).toBe("ended");
    expect(h.states.at(-1)?.sharing).toBe(false);
    h.manager.dispose();
  });
  it("suporta quatro espectadores sem duplicar a captura", async () => {
    const h = setup(host, hc);
    const others = Array.from({ length: 4 }, () => ({
      user_id: crypto.randomUUID(),
      nickname: "Amigo",
      client_id: crypto.randomUUID(),
    }));
    h.manager.setSnapshot({
      ...snapshot,
      members: [snapshot.members[0], ...others],
    });
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    for (const m of others)
      h.manager.receive(m.user_id, {
        kind: "watch",
        to: host,
        client: m.client_id,
        session: sid,
        connection: crypto.randomUUID(),
      });
    await flush();
    expect(FakePC.all).toHaveLength(4);
    expect(FakePC.all.every((p) => p.added[0] === track)).toBe(true);
    h.manager.departed(others[0].user_id);
    expect(FakePC.all[0].closed).toBe(true);
    h.manager.dispose();
    expect(FakePC.all.every((p) => p.closed)).toBe(true);
  });
});
