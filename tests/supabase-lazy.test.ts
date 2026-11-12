import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  createAuth: vi.fn(),
  session: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.create, AuthClient: mock.createAuth }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mock.create.mockImplementation(() => ({
    rpc: mock.rpc,
  }));
  mock.createAuth.mockImplementation(function () { return { getSession: mock.session }; });
});
afterEach(() => vi.unstubAllEnvs());
describe("Inicialização sob demanda", () => {
  it("não inicializa Auth/Realtime ao abrir a página e usa uma única instância quando necessário", async () => {
    const api = await import("../src/services/supabase");
    expect(mock.create).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([
      api.prepareClient(),
      api.prepareClient(),
    ]);
    expect(a).toBe(b);
    expect(mock.create).toHaveBeenCalledOnce();
  });
  it("usa o token da sessão desta aba para as operações protegidas", async () => {
    mock.session.mockResolvedValue({
      data: { session: { access_token: "token-da-aba" } },
      error: null,
    });
    const { prepareClient } = await import("../src/services/supabase");
    await prepareClient();
    const { accessToken } = mock.create.mock.calls[0][2];
    await expect(accessToken()).resolves.toBe("token-da-aba");
    mock.session.mockResolvedValue({ data: { session: null }, error: null });
    await expect(accessToken()).resolves.toBeNull();
  });
  it("carrega o catálogo pela RPC protegida", async () => {
    mock.rpc.mockResolvedValue({ data: [], error: null });
    const { listRooms } = await import("../src/services/rooms");
    await expect(listRooms(0)).resolves.toEqual([]);
    expect(mock.rpc).toHaveBeenCalledWith("list_rooms", { p_limit: 26, p_offset: 0 });
  });
});
