// One callback per attached stream. No frame analysis or continuous rendering loop.
export function firstVideoFrame(video:HTMLVideoElement,ready:()=>void){
 let active=true,id:number|undefined;
 const finish=()=>{if(!active)return;active=false;video.removeEventListener('loadeddata',fallback);video.removeEventListener('playing',fallback);ready();};
 const fallback=()=>{if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)finish();};
 if(typeof video.requestVideoFrameCallback==='function')id=video.requestVideoFrameCallback(finish);
 else{video.addEventListener('loadeddata',fallback);video.addEventListener('playing',fallback);fallback();}
 return ()=>{active=false;if(id!==undefined)video.cancelVideoFrameCallback?.(id);video.removeEventListener('loadeddata',fallback);video.removeEventListener('playing',fallback);};
}
