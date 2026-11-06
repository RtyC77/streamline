import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import {videoStill} from '../media/still';
export function Player({
  stream,
  volume,
  onError,
  onStill,
  freeze,
}: {
  stream: MediaStream;
  volume: number;
  onError: (message: string) => void;
  onStill?: (image:string)=>void;
  freeze?: {current:(()=>void)|null};
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const still=useRef(onStill);still.current=onStill;
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    video.srcObject = stream;
    const save=()=>{const image=videoStill(video);if(image)still.current?.(image);};
    let frozen=false;
    const freezeNow=()=>{if(!frozen){save();frozen=true;}};
    if(freeze)freeze.current=freezeNow;
    video.addEventListener('loadeddata',save,{once:true});
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
      freezeNow();video.removeEventListener('loadeddata',save);
      if(freeze?.current===freezeNow)freeze.current=null;
      video.pause();
      video.srcObject = null;
    };
  }, [stream,freeze]);
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
