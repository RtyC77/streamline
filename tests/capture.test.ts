import { afterEach, describe, expect, it, vi } from "vitest";
import { captureGame, tuneSender } from "../src/media/capture";
function prepare(
  audio = false,
  video = true,
  surface: MediaTrackSettings["displaySurface"] | null = "window",
) {
  const track = {
    kind: "video",
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => undefined),
    getSettings: () => ({
      width: 1280,
      height: 720,
      frameRate: 30,
      displaySurface: surface ?? undefined,
    }),
    contentHint: "",
  };
  const sound = { kind: "audio", stop: vi.fn() };
  const tracks = [...(video ? [track] : []), ...(audio ? [sound] : [])];
  const stream = {
    getTracks: () => [...tracks],
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    removeTrack: vi.fn((removed: typeof track | typeof sound) => {
      const index = tracks.indexOf(removed);
      if (index >= 0) tracks.splice(index, 1);
    }),
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
  it.each([{resolution:480 as const,fps:24 as const},{resolution:480 as const,fps:30 as const},{resolution:720 as const,fps:24 as const}])('aplica perfil %o na captura',async profile=>{
    const p=prepare();const result=await captureGame(profile);expect(result.profile).toEqual(profile);
    expect(p.track.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({height:{ideal:profile.resolution,max:profile.resolution},frameRate:{ideal:profile.fps,max:profile.fps}}));
  });
  it('aplica 480p24 também no encoder',async()=>{
    const params={encodings:[{}]};const sender={track:{kind:'video',getSettings:()=>({width:1280,height:720})},getParameters:()=>params,setParameters:vi.fn()};
    await tuneSender(sender as unknown as RTCRtpSender,1_200_000,{resolution:480,fps:24});
    expect(sender.setParameters).toHaveBeenCalledWith(expect.objectContaining({encodings:[expect.objectContaining({maxBitrate:1_200_000,maxFramerate:24,scaleResolutionDownBy:1.5})]}));
  });
  it("exclui áudio de janelas e do sistema sem fallback para microfone", async () => {
    const p = prepare(true);
    await captureGame();
    expect(p.display).toHaveBeenCalledWith(
      expect.objectContaining({
        systemAudio: "exclude",
        windowAudio: "exclude",
      }),
    );
    expect(p.display).toHaveBeenCalledTimes(1);
    expect(p.mic).not.toHaveBeenCalled();
  });
  it.each(["window", "monitor", null] as const)(
    "remove áudio de fonte %s antes de entregar a captura",
    async (surface) => {
      const p = prepare(true, true, surface);
      const result = await captureGame();
      expect(p.sound.stop).toHaveBeenCalledOnce();
      expect(p.stream.removeTrack).toHaveBeenCalledWith(p.sound);
      expect(result.stream.getAudioTracks()).toHaveLength(0);
      expect(result.stream.getVideoTracks()).toHaveLength(1);
      expect(p.track.stop).not.toHaveBeenCalled();
      expect(result.audio).toMatch(/desativado/);
    },
  );
  it("preserva a trilha de áudio retornada para uma aba compartilhada", async () => {
    const p = prepare(true, true, "browser");
    const result = await captureGame();
    expect(result.stream.getAudioTracks()).toHaveLength(1);
    expect(p.sound.stop).not.toHaveBeenCalled();
  });
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
    prepare(true,true,'browser');
    const result = await captureGame();
    expect(result.audio).toBe("Trilha de áudio da aba capturada");
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
