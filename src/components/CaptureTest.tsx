import { useEffect, useRef, useState } from "react";
import type { CaptureInfo } from "../media/capture";

export function CaptureTest({ capture, replacing, onConfirm, onCancel }: {
  capture: CaptureInfo;
  replacing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [testing, setTesting] = useState(true);
  const [audio, setAudio] = useState("Verificando áudio…");
  const [level, setLevel] = useState(0);
  const hasAudio = capture.stream.getAudioTracks().length > 0;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const preview = video.current;
    if (!testing || !preview) return;
    preview.srcObject = capture.stream;
    void preview.play().catch(() => {});
    const timeout = setTimeout(() => setTesting(false), 12_000);
    return () => {
      clearTimeout(timeout);
      preview.srcObject = null;
    };
  }, [capture, testing]);
  useEffect(() => {
    if (!testing || !hasAudio) return;
    let context: AudioContext | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(capture.stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      setAudio("Nenhum som detectado agora");
      void context.resume().catch(() => setAudio("Medidor de áudio indisponível"));
      const audioContext = context;
      timer = setInterval(() => {
        if (audioContext.state !== "running") {
          setAudio("Medidor de áudio indisponível");
          return;
        }
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((total, sample) => total + sample ** 2, 0) / samples.length);
        setLevel(Math.min(1, rms * 6));
        setAudio(previous => rms >= 0.004 || previous === "Áudio detectado"
          ? "Áudio detectado"
          : "Nenhum som detectado agora");
      }, 150);
    } catch {
      setAudio("Medidor de áudio indisponível");
    }
    return () => {
      clearInterval(timer);
      void context?.close().catch(() => {});
    };
  }, [capture, hasAudio, testing]);

  return (
    <dialog ref={dialog} aria-labelledby="capture-test-title" onCancel={onCancel}>
      <div className="dialog-head"><h2 id="capture-test-title">Teste de imagem e áudio</h2></div>
      {testing ? <video className="capture-test-video" ref={video} muted playsInline aria-label="Prévia privada da captura" />
        : <p>Prévia encerrada. Você ainda pode confirmar ou repetir o teste.</p>}
      <p role="status">{hasAudio ? audio : "Fonte sem trilha de áudio"}</p>
      {hasAudio && testing && <meter min={0} max={1} value={level} aria-label="Nível do áudio capturado" />}
      {!hasAudio && <p>{capture.audio}</p>}
      <div className="share-option-actions">
        <button className="secondary" type="button" onClick={onCancel}>Cancelar</button>
        {!testing && <button className="secondary" type="button" onClick={() => setTesting(true)}>Repetir teste</button>}
        <button className="primary" type="button" onClick={onConfirm}>
          {replacing ? "Aplicar nova tela" : "Iniciar transmissão"}
        </button>
      </div>
    </dialog>
  );
}
