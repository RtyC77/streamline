import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  channels: [] as unknown[],
  disconnect: vi.fn(),
  remove: vi.fn(),
  keep: false,
}));
vi.mock("../src/services/supabase", () => ({
  client: () => ({
    channel: (topic: string) => {
      const c = { topic, on: () => c, subscribe: () => c };
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
  vi.clearAllMocks();
});
describe("Recursos do Realtime", () => {
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
