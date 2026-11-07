import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import {videoStill} from '../media/still';
import {firstVideoFrame} from '../media/first-frame';
import {TransitionCover} from './TransitionCover';
export function Player({
  stream,
  volume,
  onError,
  onStill,
  freeze,
  poster,
  onReady,
}: {
  stream: MediaStream;
  volume: number;
  onError: (message: string) => void;
  onStill?: (image:string)=>void;
  freeze?: {current:(()=>void)|null};
  poster?:string;
  onReady?:()=>void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const still=useRef(onStill);still.current=onStill;
  const [blocked, setBlocked] = useState(false);
  const [hasFrame,setHasFrame]=useState(false);
  const ready=useRef(onReady);ready.current=onReady;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    setHasFrame(false);
    video.srcObject = stream;
    const cancelFrame=firstVideoFrame(video,()=>{if(active){setHasFrame(true);ready.current?.();}});
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
      cancelFrame();
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
      {!hasFrame&&<TransitionCover poster={poster}/>}
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
