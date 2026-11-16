import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import {videoStill} from '../media/still';
import {firstVideoFrame} from '../media/first-frame';
import {TransitionCover} from './TransitionCover';
import type { ScreenMark, ScreenPoint } from "../types";
export function Player({
  stream,
  volume,
  onError,
  onStill,
  freeze,
  poster,
  onReady,
  paused = false,
  allowMarks = false,
  mark,
  onMark,
}: {
  stream: MediaStream;
  volume: number;
  onError: (message: string) => void;
  onStill?: (image:string)=>void;
  freeze?: {current:(()=>void)|null};
  poster?:string;
  onReady?:()=>void;
  paused?: boolean;
  allowMarks?: boolean;
  mark?: ScreenMark;
  onMark?: (point: ScreenPoint) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const still=useRef(onStill);still.current=onStill;
  const [blocked, setBlocked] = useState(false);
  const [hasFrame,setHasFrame]=useState(false);
  const [marking, setMarking] = useState(false);
  const [visibleMark, setVisibleMark] = useState<ScreenPoint>();
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const canMark = allowMarks && hasFrame && !paused && !blocked;
  useEffect(() => {
    if (!canMark) setMarking(false);
  }, [canMark]);
  useEffect(() => {
    const remaining = (mark?.expiresAt ?? 0) - Date.now();
    const visible = canMark && remaining > 0 ? mark : undefined;
    setVisibleMark(visible);
    if (!visible) return;
    const timer = setTimeout(() => setVisibleMark(undefined), remaining);
    return () => clearTimeout(timer);
  }, [mark, canMark]);
  useEffect(() => {
    const video = ref.current;
    if (!video || !canMark) return;
    const measure = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const scale = Math.min(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
      setFrameSize({ width: video.videoWidth * scale, height: video.videoHeight * scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    video.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      video.removeEventListener("resize", measure);
    };
  }, [canMark]);
  const ready=useRef(onReady);ready.current=onReady;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    setHasFrame(false);
    video.srcObject = stream;
    const cancelFrame=firstVideoFrame(video,()=>{if(active){setHasFrame(true);ready.current?.();}});
    const save=()=>{if(video.muted)return;const image=videoStill(video);if(image)still.current?.(image);};
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
      <video ref={ref} autoPlay playsInline muted={paused} aria-label="Transmissão do jogo" />
      {paused && <div className="pause-cover" role="status">Transmissão pausada</div>}
      {!paused && !hasFrame && <TransitionCover poster={poster}/>}
      {canMark && <button type="button" className="secondary mark-toggle" aria-pressed={marking}
        onClick={() => setMarking(value => !value)}>
        Marcar na tela
      </button>}
      {canMark && (marking || visibleMark) && (
        <div className="mark-frame" style={frameSize}>
          {marking && <button type="button" className="mark-target" aria-label="Posicionar marcação na transmissão"
            onClick={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (!bounds.width || !bounds.height) return;
              onMark?.(event.detail === 0 ? { x: 0.5, y: 0.5 } : {
                x: (event.clientX - bounds.left) / bounds.width,
                y: (event.clientY - bounds.top) / bounds.height,
              });
            }} />}
          {visibleMark && <span className="screen-mark" aria-hidden="true"
            style={{ left: `${visibleMark.x * 100}%`, top: `${visibleMark.y * 100}%` }} />}
        </div>
      )}
      {!paused && blocked && (
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
