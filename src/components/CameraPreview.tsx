import { useEffect, useRef, useState } from "react";

export function CameraPreview({ stream, name }: { stream: MediaStream; name: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    setPlaybackError(false);
    element.srcObject = stream;
    let current = true;
    void element.play().catch(() => {
      if (current) setPlaybackError(true);
    });
    return () => {
      current = false;
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <>
      <video ref={video} autoPlay playsInline muted aria-label={`Câmera de ${name}`} />
      {playbackError && (
        <button className="camera-play" onClick={() => {
          void video.current?.play().then(() => setPlaybackError(false)).catch(() => undefined);
        }}>
          Reproduzir câmera
        </button>
      )}
    </>
  );
}
