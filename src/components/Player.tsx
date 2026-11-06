import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
export function Player({
  stream,
  volume,
  onError,
}: {
  stream: MediaStream;
  volume: number;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    video.srcObject = stream;
    void video
      .play()
      .then(() => {
        if (active) setBlocked(false);
      })
      .catch(() => {
        if (active) setBlocked(true);
      });
    return () => {
      active = false;
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  return (
    <>
      <video ref={ref} autoPlay playsInline aria-label="Transmissão do jogo" />
      {blocked && (
        <button
          className="play-overlay primary"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() =>
                onError(
                  "Clique novamente para permitir a reprodução do vídeo e do áudio.",
                ),
              );
          }}
        >
          <Icon name="play" />
          Reproduzir transmissão
        </button>
      )}
    </>
  );
}
