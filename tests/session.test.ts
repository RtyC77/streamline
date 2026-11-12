import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureInfo } from "../src/media/capture";
import type { Snapshot } from "../src/types";
const mocks = vi.hoisted(() => ({
  pulse: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  leave: vi.fn(),
  kick: vi.fn(),
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
  kickMember: mocks.kick,
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
    async publishCamera() {}
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
  const snapshot = vi.fn();
  const session = new RoomSession(initial, self, {
    snapshot,
    media: vi.fn(),
    metrics: vi.fn(),
    error,
    connection: vi.fn(),
    expired,
  });
  return { session, error, expired, snapshot };
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
  it('libera a captura nativa uma vez ao parar e sair',async()=>{
    const {session}=setup();await session.start();await flush();const source=capture();source.info.dispose=vi.fn();await session.share(source.info);await session.stop();await session.close();expect(source.info.dispose).toHaveBeenCalledOnce();
  });
  it('libera a captura nativa se a concessão for recusada',async()=>{
    const {session}=setup();await session.start();await flush();mocks.claim.mockRejectedValueOnce(new Error('Sala cheia'));const source=capture();source.info.dispose=vi.fn();await expect(session.share(source.info)).rejects.toThrow('Sala cheia');expect(source.info.dispose).toHaveBeenCalledOnce();expect(source.track.stop).toHaveBeenCalled();await session.close();
  });
  it("encerra a sessão e volta à entrada quando o servidor remove a associação", async () => {
    const { session, expired } = setup();
    await session.start();
    await flush();
    mocks.pulse.mockRejectedValue({
      message: "Sua participação expirou. Entre novamente pelo convite.",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(expired).toHaveBeenCalledOnce();
    expect(mocks.disposed).toHaveBeenCalled();
    expect(mocks.leave).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reutiliza a entrada autorizada e usa no máximo 120 pulses por hora em espera", async () => {
    const { session, snapshot } = setup();
    await session.start();
    await flush();
    expect(mocks.pulse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mocks.pulse.mock.calls.length).toBeLessThanOrEqual(120);
    expect(snapshot).toHaveBeenCalledOnce();
    await session.close();
  });
  it("renova a transmissão a cada vinte segundos, dentro da concessão de 35 segundos", async () => {
    const { session } = setup();
    await session.start();
    await flush();
    await session.share(capture().info);
    mocks.pulse.mockClear();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mocks.pulse.mock.calls.length).toBe(180);
    expect(mocks.stopLocal).not.toHaveBeenCalled();
    await session.close();
  });
  it("reduz tentativas e não sobrepõe chamadas quando o backend falha", async () => {
    const { session } = setup();
    await session.start();
    await flush();
    mocks.pulse.mockRejectedValue(new Error("offline"));
    mocks.pulse.mockClear();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(mocks.pulse.mock.calls.length).toBeLessThanOrEqual(7);
    await session.close();
  });
  it("conclui a saída anterior antes de permitir uma nova entrada", async () => {
    const page = Object.assign(new EventTarget(), {
      visibilityState: "hidden",
    });
    vi.stubGlobal("document", page);
    const pending = deferred<undefined>();
    mocks.leave.mockReturnValueOnce(pending.promise);
    const { session, expired } = setup();
    await session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.disposed).toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
    pending.resolve(undefined);
    await flush();
    expect(expired).toHaveBeenCalledOnce();
  });
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
    await vi.advanceTimersByTimeAsync(30_000);
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
      undefined,
      null,
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
