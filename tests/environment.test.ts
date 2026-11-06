import { describe, expect, it } from "vitest";
import { validatePublicEnvironment } from "../scripts/environment";
describe("Variáveis públicas de build", () => {
  it("permite interface sem configuração e endpoints públicos válidos", () => {
    expect(() => validatePublicEnvironment({})).not.toThrow();
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).not.toThrow();
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });
  it("recusa chaves secretas antes de gerar o bundle, sem registrar seu valor", () => {
    for (const key of ["sb_secret_test", "eyJhbGciOiJIUzI1NiJ9.service_role"]) {
      expect(() =>
        validatePublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: key }),
      ).toThrow(/chave pública/);
      try {
        validatePublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: key });
      } catch (e) {
        expect(String(e)).not.toContain(key);
      }
    }
  });
  it("recusa HTTP remoto, URLs com senha e política ICE inválida", () => {
    expect(() =>
      validatePublicEnvironment({ VITE_SUPABASE_URL: "http://remote.example" }),
    ).toThrow();
    expect(() =>
      validatePublicEnvironment({
        VITE_SUPABASE_URL: "https://user:password@example.com",
      }),
    ).toThrow();
    expect(() =>
      validatePublicEnvironment({ VITE_ICE_TRANSPORT_POLICY: "any" }),
    ).toThrow();
  });
});
