import {describe,it,expect,vi} from 'vitest';
import {firstVideoFrame} from '../src/media/first-frame';
describe('Primeiro quadro do player',()=>{
 it('espera um quadro apresentado e não mantém callback contínuo',()=>{
  let frame!:()=>void;const ready=vi.fn(),request=vi.fn(callback=>{frame=callback;return 12;}),cancel=vi.fn();
  const video={requestVideoFrameCallback:request,cancelVideoFrameCallback:cancel,removeEventListener:vi.fn()} as unknown as HTMLVideoElement;
  const dispose=firstVideoFrame(video,ready);expect(ready).not.toHaveBeenCalled();frame();frame();expect(ready).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();dispose();
 });
 it('ignora callbacks que chegam depois da troca de stream',()=>{
  let frame!:()=>void;const ready=vi.fn(),cancel=vi.fn();const video={requestVideoFrameCallback:(callback:()=>void)=>{frame=callback;return 3;},cancelVideoFrameCallback:cancel,removeEventListener:vi.fn()} as unknown as HTMLVideoElement;
  const dispose=firstVideoFrame(video,ready);dispose();frame();expect(ready).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledWith(3);
 });
 it('no fallback exige dados e dimensões de vídeo e remove listeners após sucesso',()=>{
  const events=new Map<string,()=>void>(),ready=vi.fn();const value={readyState:0,videoWidth:0,videoHeight:0,addEventListener:(name:string,callback:()=>void)=>events.set(name,callback),removeEventListener:(name:string)=>events.delete(name)};
  firstVideoFrame(value as unknown as HTMLVideoElement,ready);events.get('loadeddata')?.();expect(ready).not.toHaveBeenCalled();value.readyState=2;value.videoWidth=854;value.videoHeight=480;events.get('playing')?.();expect(ready).toHaveBeenCalledOnce();expect(events.size).toBe(0);
 });
});
