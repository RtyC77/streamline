import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  session: vi.fn(),
  signIn: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.create }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mock.create.mockImplementation(() => ({
    rpc: mock.rpc,
    auth: { getSession: mock.session, signInAnonymously: mock.signIn },
  }));
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
  it("reutiliza a identidade existente sem criar outro usuário anônimo", async () => {
    mock.session.mockResolvedValue({
      data: { session: { user: { id: "mesmo-usuario" } } },
      error: null,
    });
    const api = await import("../src/services/supabase");
    expect(await api.authenticate()).toBe("mesmo-usuario");
    expect(mock.signIn).not.toHaveBeenCalled();
  });
  it("carrega o catálogo antes de autenticar ou entrar em uma sala", async () => {
    mock.rpc.mockResolvedValue({ data: [], error: null });
    const { listRooms } = await import("../src/services/rooms");
    await expect(listRooms(0)).resolves.toEqual([]);
    expect(mock.rpc).toHaveBeenCalledWith("list_rooms", { p_limit: 26, p_offset: 0 });
    expect(mock.signIn).not.toHaveBeenCalled();
  });
});
