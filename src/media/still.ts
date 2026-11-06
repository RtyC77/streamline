// Only one-shot thumbnails. No animation loop, recording, or canvas video pipeline.
export function videoStill(video:HTMLVideoElement):string|null {
 if(video.readyState<2||!video.videoWidth||!video.videoHeight)return null;
 try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d');if(!context)return null;context.drawImage(video,0,0,320,180);const image=canvas.toDataURL('image/jpeg',0.45);return validStill(image)?image:null;}catch{return null;}
}
export function validStill(value:unknown):value is string{return typeof value==='string'&&value.length<=60000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);}
export async function firstStill(stream:MediaStream):Promise<string|null>{
 if(typeof document==='undefined'||typeof document.createElement!=='function')return null;
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let finish:()=>void=()=>{};
 try{
  const ready=new Promise<void>(resolve=>{finish=resolve;video.onloadeddata=resolve as ()=>void;timer=setTimeout(resolve,3000);});
  void video.play().catch(()=>finish());await ready;
  return videoStill(video);
 }finally{if(timer)clearTimeout(timer);video.onloadeddata=null;video.pause();video.srcObject=null;}
}
