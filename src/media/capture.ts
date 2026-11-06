import { target } from "../config";
export interface CaptureInfo {
  stream: MediaStream;
  settings: MediaTrackSettings;
  audio: string;
  tuning: string;
}
export function captureSupported() {
  return (
    window.isSecureContext &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof RTCPeerConnection !== "undefined"
  );
}
export async function captureGame(): Promise<CaptureInfo> {
  if (!captureSupported())
    throw new Error(
      "Use Chrome ou Edge atualizado em HTTPS (ou localhost) para compartilhar.",
    );
  // No standardized feature probe exists for DisplayMediaStreamOptions dictionary
  // members. Unknown hints are ignored by conforming browsers; tracks are truth.
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
    windowAudio: "window",
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = stream.getVideoTracks()[0];
  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("O navegador não retornou vídeo. Selecione outra janela.");
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
    settings: video.getSettings(),
    tuning,
    audio: stream.getAudioTracks().length
      ? "Trilha de áudio capturada"
      : "Sem áudio: o navegador não disponibilizou uma trilha. O vídeo continua normalmente.",
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
export async function tuneSender(sender: RTCRtpSender, bitrate: number) {
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
