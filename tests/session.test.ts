import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureInfo } from "../src/media/capture";
import type { Snapshot } from "../src/types";
const mocks = vi.hoisted(() => ({
  pulse: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  leave: vi.fn(),
  setLocal: vi.fn(),
  stopLocal: vi.fn(),
  disposed: vi.fn(),
}));
vi.mock("../src/services/supabase", () => ({
  iceConfiguration: vi.fn(async () => ({ iceServers: [] })),
}));
vi.mock("../src/services/rooms", () => ({
  pulse: mocks.pulse,
  claimStream: mocks.claim,
  releaseStream: mocks.release,
  leaveRoom: mocks.leave,
  tabId: () => "tab",
}));
vi.mock("../src/services/signaling", () => ({
  Signaling: class {
    ready: (value: boolean) => void;
    started = false;
    constructor(
      _r: unknown,
      _u: unknown,
      _receive: unknown,
      _presence: unknown,
      ready: (value: boolean) => void,
    ) {
      this.ready = ready;
    }
    async sync() {
      if (!this.started) {
        this.started = true;
        this.ready(true);
      }
    }
    async send() {}
    async notifyChange() {}
    async close() {}
  },
}));
vi.mock("../src/media/peers", () => ({
  Peers: class {
    setSnapshot() {}
    configure() {}
    async maintain() {}
    async sample() {}
    departed() {}
    setLocal = mocks.setLocal;
    stopLocal = mocks.stopLocal;
    dispose = mocks.disposed;
  },
}));
import { RoomSession } from "../src/services/session";
const room = crypto.randomUUID(),
  self = crypto.randomUUID(),
  sid = crypto.randomUUID();
const initial: Snapshot = {
  room: {
    id: room,
    name: "Sala",
    expires_at: "2099-01-01",
    channel_epoch: crypto.randomUUID(),
    broadcaster_id: null,
    stream_session: null,
  },
  members: [{ user_id: self, nickname: "Host", client_id: "tab" }],
};
const active: Snapshot = {
  ...initial,
  room: { ...initial.room, broadcaster_id: self, stream_session: sid },
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function capture() {
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    stop: vi.fn(),
  });
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return {
    track,
    info: {
      stream,
      settings: {},
      audio: "Sem áudio",
      tuning: "",
    } as unknown as CaptureInfo,
  };
}
function setup() {
  const error = vi.fn();
  const expired = vi.fn();
  const session = new RoomSession(initial, self, {
    snapshot: vi.fn(),
    media: vi.fn(),
    metrics: vi.fn(),
    error,
    connection: vi.fn(),
    expired,
  });
  return { session, error, expired };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget());
  let claimed = false;
  mocks.pulse.mockImplementation(async () => (claimed ? active : initial));
  mocks.claim.mockImplementation(async () => {
    claimed = true;
    return sid;
  });
  mocks.release.mockResolvedValue(undefined);
  mocks.leave.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Ciclo da sala e respostas concorrentes", () => {
  it("encerra peers, associação e heartbeats ao expirar em segundo plano", async () => {
    const page = Object.assign(new EventTarget(), {
      visibilityState: "hidden",
    });
    vi.stubGlobal("document", page);
    const { session, expired } = setup();
    await session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flush();
    expect(expired).toHaveBeenCalledOnce();
    expect(mocks.disposed).toHaveBeenCalled();
    expect(mocks.leave).toHaveBeenCalledWith(room);
    const calls = mocks.pulse.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.pulse).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("mantém transmissão ativa ao trocar para a janela do jogo", async () => {
    const page = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    vi.stubGlobal("document", page);
    const { session, expired } = setup();
    await session.start();
    await flush();
    await session.share(capture().info);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(expired).not.toHaveBeenCalled();
    expect(mocks.leave).not.toHaveBeenCalled();
    await session.close();
  });
  it("aguarda heartbeat em andamento antes de iniciar captura para não aplicar snapshot antigo depois", async () => {
    const { session } = setup();
    await session.start();
    await flush();
    const pending = deferred<Snapshot>();
    mocks.pulse.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(10_000);
    const c = capture();
    const sharing = session.share(c.info);
    await flush();
    expect(mocks.claim).not.toHaveBeenCalled();
    pending.resolve(initial);
    await sharing;
    expect(mocks.setLocal).toHaveBeenCalledWith(
      c.info.stream,
      sid,
      "Sem áudio",
    );
    expect(c.track.stop).not.toHaveBeenCalled();
    await session.close();
  });
  it("fecha recursos e limpa a concessão quando o usuário sai durante uma solicitação pendente", async () => {
    const { session } = setup();
    await session.start();
    await flush();
    const pending = deferred<string>();
    mocks.claim.mockReturnValueOnce(pending.promise);
    const c = capture();
    const sharing = session.share(c.info);
    await flush();
    const closing = session.close(true);
    pending.resolve(sid);
    const results = await Promise.allSettled([sharing, closing]);
    expect(results[0].status).toBe("rejected");
    expect(c.track.stop).toHaveBeenCalled();
    expect(mocks.setLocal).not.toHaveBeenCalled();
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(mocks.disposed).toHaveBeenCalled();
  });
  it("usa a mesma parada quando o navegador encerra o compartilhamento", async () => {
    const { session } = setup();
    await session.start();
    await flush();
    const c = capture();
    await session.share(c.info);
    c.track.readyState = "ended";
    c.track.dispatchEvent(new Event("ended"));
    await flush();
    expect(mocks.stopLocal).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(room, sid);
    await session.close();
  });
});
