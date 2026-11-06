import { afterEach, describe, expect, it, vi } from "vitest";
import { captureGame, tuneSender } from "../src/media/capture";
function prepare(audio = false, video = true) {
  const track = {
    kind: "video",
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => undefined),
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    contentHint: "",
  };
  const sound = { kind: "audio", stop: vi.fn() };
  const stream = {
    getTracks: () => [...(video ? [track] : []), ...(audio ? [sound] : [])],
    getVideoTracks: () => (video ? [track] : []),
    getAudioTracks: () => (audio ? [sound] : []),
  };
  const display = vi.fn(async () => stream);
  const mic = vi.fn();
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("RTCPeerConnection", class {});
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: display,
      getUserMedia: mic,
      getSupportedConstraints: () => ({
        width: true,
        height: true,
        frameRate: true,
      }),
    },
  });
  return { track, sound, stream, display, mic };
}
afterEach(() => vi.unstubAllGlobals());
describe("Captura respeita o navegador", () => {
  it("continua com vídeo sem áudio e não solicita microfone", async () => {
    const p = prepare();
    const result = await captureGame();
    expect(result.stream).toBe(p.stream);
    expect(result.audio).toMatch(/Sem áudio/);
    expect(p.mic).not.toHaveBeenCalled();
    expect(p.display.mock.calls[0]).toBeDefined();
    expect(p.track.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
    });
  });
  it("só informa trilha de áudio quando ela foi retornada", async () => {
    prepare(true);
    const result = await captureGame();
    expect(result.audio).toBe("Trilha de áudio capturada");
  });
  it("encerra trilhas se o navegador não retornar vídeo", async () => {
    const p = prepare(true, false);
    await expect(captureGame()).rejects.toThrow("não retornou vídeo");
    expect(p.sound.stop).toHaveBeenCalled();
  });
  it("não bloqueia vídeo quando o navegador recusar constraints", async () => {
    const p = prepare();
    p.track.applyConstraints.mockRejectedValue(
      new DOMException("Unsupported", "OverconstrainedError"),
    );
    const result = await captureGame();
    expect(result.stream).toBe(p.stream);
    expect(result.tuning).toMatch(/não aceitou/);
  });
  it("não repete o diálogo nem contorna recusa de permissão", async () => {
    const p = prepare();
    p.display.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await expect(captureGame()).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(p.display).toHaveBeenCalledTimes(1);
    expect(p.mic).not.toHaveBeenCalled();
  });
  it("aplica limite no encoder sem ampliar uma captura menor", async () => {
    const params = { encodings: [{}], degradationPreference: undefined };
    const sender = {
      track: {
        kind: "video",
        getSettings: () => ({ width: 640, height: 360 }),
      },
      getParameters: () => params,
      setParameters: vi.fn(async () => undefined),
    };
    await tuneSender(sender as unknown as RTCRtpSender, 3_000_000);
    expect(sender.setParameters).toHaveBeenCalledWith({
      encodings: [
        { maxBitrate: 3_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
      ],
      degradationPreference: "maintain-framerate",
    });
  });
});
