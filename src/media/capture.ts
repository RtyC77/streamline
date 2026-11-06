import {defaultProfile,videoProfile,type CaptureProfile} from './profile';
export interface CaptureInfo {
  stream: MediaStream;
  settings: MediaTrackSettings;
  audio: string;
  tuning: string;
  profile?: CaptureProfile;
}
export function captureSupported() {
  return (
    window.isSecureContext &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof RTCPeerConnection !== "undefined"
  );
}
export async function captureGame(profile:CaptureProfile=defaultProfile): Promise<CaptureInfo> {
  const target=videoProfile(profile);
  if (!captureSupported())
    throw new Error(
      "Use Chrome ou Edge atualizado em HTTPS (ou localhost) para compartilhar.",
    );
  // windowAudio is only a picker hint; it cannot prove per-application isolation.
  // Request tab audio only, then reject any audio accompanying another surface.
  const options: DisplayMediaStreamOptions & {
    windowAudio: string;
    systemAudio: string;
    selfBrowserSurface: string;
    surfaceSwitching: string;
  } = {
    video: {
      displaySurface: "window",
      frameRate: { ideal: target.fps, max: target.fps },
    },
    audio: {
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    windowAudio: "exclude",
    systemAudio: "exclude",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = stream.getVideoTracks()[0];
  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("O navegador não retornou vídeo. Selecione outra janela.");
  }
  // A window video track can accompany system-wide audio. Neither its surface,
  // track label, browser version nor restrictOwnAudio proves isolation of a game.
  // Fail closed even when a browser ignores the exclusion hints.
  const surface = video.getSettings().displaySurface;
  const scopedSurface = surface === "browser";
  if (!scopedSurface)
    for (const audio of stream.getAudioTracks()) {
      audio.stop();
      stream.removeTrack(audio);
    }
  let tuning = "Resolução e FPS solicitados ao navegador.";
  try {
    const supported = navigator.mediaDevices.getSupportedConstraints();
    await video.applyConstraints({
      ...(supported.width
        ? { width: { ideal: target.width, max: target.width } }
        : {}),
      ...(supported.height
        ? { height: { ideal: target.height, max: target.height } }
        : {}),
      ...(supported.frameRate
        ? { frameRate: { ideal: target.fps, max: target.fps } }
        : {}),
    });
  } catch {
    tuning =
      "O navegador não aceitou todos os limites de captura; confira a resolução e o FPS reais.";
  }
  video.contentHint = "motion";
  return {
    stream,
    profile,
    settings: video.getSettings(),
    tuning,
    audio: stream.getAudioTracks().length
      ? "Trilha de áudio da aba capturada"
      : !scopedSurface
        ? "Sem áudio: o áudio de janelas e telas inteiras foi desativado para impedir o som de outros aplicativos. O vídeo continua. Áudio restrito está disponível ao compartilhar uma aba do navegador."
        : "Sem áudio: o navegador não disponibilizou áudio da aba selecionada. O vídeo continua normalmente.",
  };
}
export function preferCodecs(pc: RTCPeerConnection) {
  for (const t of pc.getTransceivers()) {
    const kind = t.sender.track?.kind ?? t.receiver.track.kind;
    const codecs = RTCRtpReceiver.getCapabilities?.(kind)?.codecs;
    if (!codecs || !t.setCodecPreferences) continue;
    const preferred = kind === "video" ? "video/h264" : "audio/opus";
    try {
      t.setCodecPreferences(
        [...codecs].sort(
          (a, b) =>
            Number(b.mimeType.toLowerCase() === preferred) -
            Number(a.mimeType.toLowerCase() === preferred),
        ),
      );
    } catch {
      /* Native codec fallback, verified by stats. */
    }
  }
}
export async function tuneSender(sender: RTCRtpSender, bitrate: number, profile:CaptureProfile=defaultProfile) {
  const target=videoProfile(profile);
  if (sender.track?.kind !== "video") return;
  const params = sender.getParameters();
  if (!params.encodings?.length) return;
  const settings = sender.track.getSettings();
  for (const e of params.encodings) {
    e.maxBitrate = bitrate;
    e.maxFramerate = target.fps;
    e.scaleResolutionDownBy = Math.max(
      1,
      (settings.width ?? target.width) / target.width,
      (settings.height ?? target.height) / target.height,
    );
  }
  params.degradationPreference = "maintain-framerate";
  await sender.setParameters(params);
}
