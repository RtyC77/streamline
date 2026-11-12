import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  channels: [] as unknown[],
  disconnect: vi.fn(),
  remove: vi.fn(),
  keep: false,
  subscriptions: new Map<string, (status: string) => void>(),
}));
vi.mock("../src/services/supabase", () => ({
  client: () => ({
    channel: (topic: string) => {
      const c = {
        topic,
        on: () => c,
        subscribe: (callback: (status: string) => void) => {
          state.subscriptions.set(topic, callback);
          return c;
        },
        track: async () => "ok",
      };
      state.channels.push(c);
      return c;
    },
    removeChannel: async (c: unknown) => {
      state.remove(c);
      if (state.keep) return "timed out";
      state.channels = state.channels.filter((item) => item !== c);
      return "ok";
    },
    getChannels: () => state.channels,
    removeAllChannels: async () => {
      state.channels = [];
      state.disconnect();
    },
    realtime: { disconnect: state.disconnect },
  }),
}));
import { Signaling } from "../src/services/signaling";
beforeEach(() => {
  state.channels = [];
  state.keep = false;
  state.subscriptions.clear();
  vi.clearAllMocks();
});
describe("Recursos do Realtime", () => {
  it("aguarda a primeira inscrição e sinaliza a interrupção de um canal já conectado", async () => {
    const status = vi.fn();
    const fail = vi.fn();
    const s = new Signaling("room", "self", () => {}, () => {}, status, fail);
    const members = [{ user_id: "self", client_id: "tab", nickname: "Eu" }];
    await s.sync(members, "initial");
    expect(status).not.toHaveBeenCalled();

    state.subscriptions.get("room:room:initial:user:self")!("SUBSCRIBED");
    await s.sync(members, "next");
    expect(status.mock.calls).toEqual([[true], [false]]);

    const notify = state.subscriptions.get("room:room:next:user:self")!;
    notify("TIMED_OUT");
    expect(fail).toHaveBeenCalledOnce();
    notify("SUBSCRIBED");
    expect(status).toHaveBeenLastCalledWith(true);
    await s.close();
  });
  it("libera o socket mesmo se a saída individual de canal atingir timeout", async () => {
    state.keep = true;
    const s = new Signaling(
      "room",
      "self",
      () => {},
      () => {},
      () => {},
    );
    await s.sync(
      [{ user_id: "self", client_id: "tab", nickname: "Eu" }],
      "epoch",
    );
    await s.close();
    expect(state.channels).toHaveLength(0);
    expect(state.disconnect).toHaveBeenCalledOnce();
  });
  it("reutiliza canais quando a geração e participantes não mudam", async () => {
    const s = new Signaling(
      "room",
      "self",
      () => {},
      () => {},
      () => {},
    );
    const members = [{ user_id: "self", client_id: "tab", nickname: "Eu" }];
    await s.sync(members, "epoch");
    await s.sync([...members], "epoch");
    expect(state.channels).toHaveLength(1);
    expect(state.remove).not.toHaveBeenCalled();
    await s.close();
  });
  it("desconecta o WebSocket ao sair do último canal", async () => {
    const s = new Signaling(
      "room",
      "self",
      () => {},
      () => {},
      () => {},
    );
    await s.sync(
      [{ user_id: "self", client_id: "tab", nickname: "Eu" }],
      "epoch",
    );
    await s.close();
    expect(state.channels).toHaveLength(0);
    expect(state.disconnect).toHaveBeenCalledOnce();
  });
  it("preserva a conexão se outra sessão ainda tiver um canal", async () => {
    const s = new Signaling(
      "room",
      "self",
      () => {},
      () => {},
      () => {},
    );
    await s.sync(
      [{ user_id: "self", client_id: "tab", nickname: "Eu" }],
      "epoch",
    );
    state.channels.push({ topic: "outra-sessao" });
    await s.close();
    expect(state.channels).toHaveLength(1);
    expect(state.disconnect).not.toHaveBeenCalled();
  });
});
