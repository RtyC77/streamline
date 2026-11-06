import { describe, it, expect } from "vitest";
import { parseSignal } from "../src/services/signaling";
import { parseInvite } from "../src/services/rooms";
import { parseIce } from "../src/config";
import { bitrate } from "../src/media/stats";
const base = {
  to: crypto.randomUUID(),
  session: crypto.randomUUID(),
  connection: crypto.randomUUID(),
  client: crypto.randomUUID(),
};
describe("Convites e mensagens não confiáveis", () => {
  it("aceita código e URL com fragmento, sem confundir UUID da sala com autorização", () => {
    const token = "a".repeat(64);
    expect(parseInvite(token)).toBe(token);
    expect(parseInvite(`https://example.com/#convite=${token}`)).toBe(token);
    expect(() => parseInvite(crypto.randomUUID())).toThrow();
    expect(() =>
      parseInvite("https://example.com/?convite=" + token),
    ).toThrow();
  });
  it("valida destinatário, sessão, conexão e tamanho de SDP", () => {
    expect(parseSignal({ ...base, kind: "watch" })).not.toBeNull();
    expect(parseSignal({ ...base, kind: "offer", sdp: "v=0" })).not.toBeNull();
    for (const bad of [
      null,
      {},
      { ...base, to: "*", kind: "watch" },
      { ...base, kind: "offer", sdp: "a".repeat(100001) },
      { ...base, kind: "execute" },
    ])
      expect(parseSignal(bad)).toBeNull();
  });
  it("rejeita candidatos ICE malformados", () => {
    expect(
      parseSignal({
        ...base,
        kind: "ice",
        candidate: {
          candidate: "candidate:abc",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    ).not.toBeNull();
    expect(
      parseSignal({ ...base, kind: "ice", candidate: { candidate: 123 } }),
    ).toBeNull();
  });
});
describe("Configuração e medidas", () => {
  it("valida listas de servidores ICE", () => {
    expect(parseIce()).toHaveLength(1);
    expect(() => parseIce("{}")).toThrow();
    expect(() => parseIce('[{"urls":123}]')).toThrow();
  });
  it("mede bitrate usando bytes e timestamps reais", () => {
    expect(
      bitrate(
        { bytes: 1_000_000, timestamp: 2000 },
        { bytes: 0, timestamp: 1000 },
      ),
    ).toBe(8_000_000);
  });
  it("não inventa medidas antes da primeira amostra ou após reset do contador", () => {
    expect(bitrate({ bytes: 0, timestamp: 1000 })).toBeUndefined();
    expect(
      bitrate({ bytes: 0, timestamp: 2000 }, { bytes: 500, timestamp: 1000 }),
    ).toBeUndefined();
  });
});
