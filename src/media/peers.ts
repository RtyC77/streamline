import type {MediaState,PeerMetric,Signal,SignalBody,Snapshot} from '../types';
import {activeStreams} from '../types';
import {preferCodecs,tuneSender} from './capture';
import {defaultProfile,videoProfile,type CaptureProfile} from './profile';
import {validStill} from './still';
import {collectStats,type Counter} from './stats';
interface Peer {
 pc:RTCPeerConnection; id:string; outgoing:boolean; preview:boolean;
 connection:string; session:string; ice:RTCIceCandidateInit[]; pending:RTCIceCandidateInit[];
 iceTimer:ReturnType<typeof setTimeout>|null; counters:Map<string,Counter>;
 created:number; retries:number; restartAt:number; bitrate:number; negotiating:boolean; data:RTCDataChannel|null;
}
export class Peers {
 private peers=new Map<string,Peer>();
 private snapshot:Snapshot|null=null;
 private stream:MediaStream|null=null;
 private localSession:string|null=null;
 private selected:string|null=null;
 private remote:MediaStream|null=null;
 private poster:string|null=null;
 private previews=new Set<string>();
 private profile:CaptureProfile=defaultProfile;
 private disposed=false;
 private queue:Promise<void>=Promise.resolve();
 private audio='Sem trilha';
 private remoteAudio='Sem trilha';
 private statisticsRunning=false;
 private maintaining=false;
 private lastState:MediaState|null=null;
 constructor(private self:string,private clientId:string,private config:RTCConfiguration,
  private send:(s:Signal)=>Promise<void>,private update:(s:MediaState)=>void,
  private metrics:(m:PeerMetric[])=>void,private warn:(e:unknown)=>void,
  private preview:(session:string,image:string)=>void=()=>{}){}
 private key(id:string,outgoing:boolean){return `${outgoing?'out':'in'}:${id}`;}
 private emit(){
  const state:MediaState={sharing:!!this.stream,selected:this.selected,remote:this.remote,captureAudio:this.audio,
   audio:this.remote?this.remoteAudio:this.audio,
   connections:[...this.peers.values()].filter(p=>p.outgoing&&!p.preview&&p.pc.connectionState==='connected').length,
   status:[...this.peers.values()].some(p=>!p.preview&&(p.pc.connectionState==='failed'||p.pc.connectionState==='disconnected'))?'Conexão perdida; tentando novamente':this.remote?'Recebendo transmissão':this.stream?'Transmitindo':this.selected?'Conectando à tela':'Aguardando transmissão'};
  const old=this.lastState;
  if(old&&Object.keys(state).every(k=>state[k as keyof MediaState]===old[k as keyof MediaState]))return;
  this.lastState=state;this.update(state);
 }
 configure(config:RTCConfiguration){this.config=config;for(const p of this.peers.values())p.pc.setConfiguration(config);}
 private close(key:string){
  const p=this.peers.get(key);if(!p)return;
  this.peers.delete(key);if(p.iceTimer)clearTimeout(p.iceTimer);
  p.pc.ontrack=null;p.pc.onicecandidate=null;p.pc.onconnectionstatechange=null;
  if(p.data){p.data.onopen=null;p.data.onmessage=null;p.data.onclose=null;p.data.close();}
  p.pc.close();this.balanceTracks();
 }
 private clearRemote(){this.remote?.getTracks().forEach(t=>t.stop());this.remote=null;this.remoteAudio='Sem trilha';}
 setSnapshot(snapshot:Snapshot){
  if(this.disposed)return;this.snapshot=snapshot;const streams=activeStreams(snapshot);
  for(const session of this.previews)if(!streams.some(s=>s.session_id===session))this.previews.delete(session);
  if(this.stream&&!streams.some(s=>s.broadcaster_id===this.self&&s.session_id===this.localSession))this.stopLocal();
  for(const [key,p]of this.peers)if(!snapshot.members.some(m=>m.user_id===p.id)||!streams.some(s=>s.session_id===p.session&&s.broadcaster_id===(p.outgoing?this.self:p.id)))this.close(key);
  if(!streams.some(s=>s.session_id===this.selected))this.select(streams.find(s=>s.broadcaster_id!==this.self)?.session_id??streams[0]?.session_id??null);
  this.balanceTracks();this.emit();
 }
 select(session:string|null){
  if(this.disposed||session===this.selected)return;
  if(session&&(!this.snapshot||!activeStreams(this.snapshot).some(s=>s.session_id===session)))return;
  for(const [key,p]of this.peers)if(!p.outgoing&&!p.preview){void this.send(this.envelope(p,{kind:'unwatch'})).catch(this.warn);this.close(key);}
  const sender=this.snapshot&&activeStreams(this.snapshot).find(s=>s.session_id===session);
  if(sender)this.close(this.key(sender.broadcaster_id,false));
  this.selected=session;this.clearRemote();this.emit();
 }
 rememberPreview(session:string){this.previews.add(session);}
 setLocal(stream:MediaStream,session:string,audio:string,profile:CaptureProfile=defaultProfile,poster:string|null=null){
  if(this.disposed){stream.getTracks().forEach(t=>t.stop());return;}
  if(this.stream)this.stopLocal();
  this.stream=stream;this.localSession=session;this.profile=profile;this.poster=poster;this.audio=audio;
  if(poster){this.previews.add(session);this.preview(session,poster);}
  this.balanceTracks();this.emit();
 }
 stopLocal(){
  this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.localSession=null;this.poster=null;this.audio='Sem trilha';
  for(const [key,p]of this.peers)if(p.outgoing)this.close(key);this.emit();
 }
 private balanceTracks(){
  const enabled=[...this.peers.values()].some(p=>p.outgoing&&!p.preview);
  this.stream?.getTracks().forEach(t=>{if(t.enabled!==enabled)t.enabled=enabled;});
 }
 private envelope(p:Peer,body:SignalBody):Signal{return {...body,to:p.id,session:p.session,connection:p.connection,client:this.clientId};}
 private flushIce(p:Peer){
  if(p.iceTimer)clearTimeout(p.iceTimer);p.iceTimer=null;
  if(!p.pending.length||this.peers.get(this.key(p.id,p.outgoing))!==p)return;
  const candidates=p.pending.splice(0,16);void this.send(this.envelope(p,{kind:'ice-batch',candidates})).catch(this.warn);
  if(p.pending.length)p.iceTimer=setTimeout(()=>this.flushIce(p),150);
 }
 private create(id:string,connection:string,session:string,outgoing:boolean,preview=false):Peer{
  const key=this.key(id,outgoing);this.close(key);const pc=new RTCPeerConnection(this.config);
  const p:Peer={pc,id,outgoing,preview,connection,session,ice:[],pending:[],iceTimer:null,counters:new Map(),created:Date.now(),retries:0,restartAt:0,bitrate:videoProfile(this.profile).bitrate,negotiating:false,data:null};
  this.peers.set(key,p);
  pc.onicecandidate=e=>{
   if(this.peers.get(key)!==p)return;
   if(e.candidate){if(p.pending.length<64)p.pending.push(e.candidate.toJSON());if(!p.iceTimer)p.iceTimer=setTimeout(()=>this.flushIce(p),150);}
   else this.flushIce(p);
  };
  pc.ontrack=e=>{
   if(outgoing||preview||session!==this.selected||this.peers.get(key)!==p)return;
   this.remote??=new MediaStream();if(!this.remote.getTracks().some(t=>t.id===e.track.id))this.remote.addTrack(e.track);
   this.remoteAudio=this.remote.getAudioTracks().length?'Trilha de áudio recebida':'Sem trilha de áudio';this.emit();
  };
  pc.onconnectionstatechange=()=>{if(this.peers.get(key)!==p)return;if(preview&&pc.connectionState==='failed')this.close(key);this.emit();};
  if(preview){
   let received=false;
   const dc=pc.createDataChannel('still',{negotiated:true,id:0,ordered:true});p.data=dc;
   dc.onopen=()=>{if(outgoing&&this.peers.get(key)===p){try{dc.send(this.poster??'unavailable');}catch{this.close(key);}}};
   dc.onmessage=e=>{
    if(this.peers.get(key)!==p)return;
    if(outgoing){if(e.data==='ack')this.close(key);return;}
    if(received)return;received=true;
    if(validStill(e.data)){this.previews.add(session);this.preview(session,e.data);}
    try{dc.send('ack');}catch{this.close(key);}
   };
   dc.onclose=()=>{if(this.peers.get(key)===p)this.close(key);};
  }else if(outgoing&&this.stream)for(const track of this.stream.getTracks())pc.addTrack(track,this.stream);
  preferCodecs(pc);this.balanceTracks();return p;
 }
 private async offer(p:Peer,restart=false){
  if(p.negotiating||p.pc.signalingState!=='stable')return;p.negotiating=true;
  try{await p.pc.setLocalDescription(await p.pc.createOffer({iceRestart:restart}));if(p.pc.localDescription?.sdp)await this.send(this.envelope(p,{kind:'offer',sdp:p.pc.localDescription.sdp}));}finally{p.negotiating=false;}
 }
 private async drain(p:Peer){for(const c of p.ice.splice(0))await p.pc.addIceCandidate(c);}
 receive(id:string,signal:Signal){
  this.queue=this.queue.then(async()=>{
   const snapshot=this.snapshot;if(this.disposed||!snapshot||!snapshot.members.some(m=>m.user_id===id&&m.client_id===signal.client))return;
   const streams=activeStreams(snapshot);
   if(signal.kind==='watch'){
    if(!this.stream||this.localSession!==signal.session||!streams.some(s=>s.broadcaster_id===this.self&&s.session_id===signal.session))return;
    const existing=this.peers.get(this.key(id,true));if(existing?.connection===signal.connection)return;
    const p=this.create(id,signal.connection,signal.session,true,signal.preview===true);await this.offer(p);return;
   }
   if(signal.kind==='unwatch'){
    const p=this.peers.get(this.key(id,true));if(p?.connection===signal.connection&&p.session===signal.session)this.close(this.key(id,true));return;
   }
   const outgoing=signal.session===this.localSession;
   if(!streams.some(s=>s.session_id===signal.session&&s.broadcaster_id===(outgoing?this.self:id)))return;
   const p=this.peers.get(this.key(id,outgoing));if(!p||p.connection!==signal.connection||p.session!==signal.session)return;
   if(signal.kind==='ice'||signal.kind==='ice-batch'){
    const candidates=signal.kind==='ice'?[signal.candidate]:signal.candidates;
    for(const c of candidates)if(p.pc.remoteDescription)await p.pc.addIceCandidate(c);else if(p.ice.length<64)p.ice.push(c);
   }else if(signal.kind==='offer'&&!outgoing){
    if(p.pc.signalingState!=='stable')return;
    await p.pc.setRemoteDescription({type:'offer',sdp:signal.sdp});await this.drain(p);preferCodecs(p.pc);
    await p.pc.setLocalDescription(await p.pc.createAnswer());if(p.pc.localDescription?.sdp)await this.send(this.envelope(p,{kind:'answer',sdp:p.pc.localDescription.sdp}));
   }else if(signal.kind==='answer'&&outgoing&&p.pc.signalingState==='have-local-offer'){
    await p.pc.setRemoteDescription({type:'answer',sdp:signal.sdp});await this.drain(p);
    if(!p.preview)await Promise.all(p.pc.getSenders().map(s=>tuneSender(s,p.bitrate,this.profile).catch(()=>this.warn(new Error('O navegador não aceitou todos os limites do encoder. Confira o diagnóstico.')))));
   }
  }).catch(e=>{if(!this.disposed)this.warn(e);});
 }
 async maintain(){
  if(this.disposed||!this.snapshot||this.maintaining)return;this.maintaining=true;
  try{
   const streams=activeStreams(this.snapshot);
   for(const [key,p]of this.peers)if(p.preview&&Date.now()-p.created>15_000)this.close(key);
   const selected=streams.find(s=>s.session_id===this.selected&&s.broadcaster_id!==this.self);
   if(selected){
    const p=this.peers.get(this.key(selected.broadcaster_id,false));
    if(!p||(!p.preview&&p.pc.connectionState!=='connected'&&Date.now()-p.created>20_000)){
     this.clearRemote();const next=this.create(selected.broadcaster_id,crypto.randomUUID(),selected.session_id,false);
     await this.send(this.envelope(next,{kind:'watch'}));this.emit();
    }
   }
   // One temporary data-only connection at a time, once per unseen session.
   if(![...this.peers.values()].some(p=>!p.outgoing&&p.preview)){
    const next=streams.find(s=>s.broadcaster_id!==this.self&&s.session_id!==this.selected&&!this.previews.has(s.session_id));
    if(next){this.previews.add(next.session_id);const p=this.create(next.broadcaster_id,crypto.randomUUID(),next.session_id,false,true);await this.send(this.envelope(p,{kind:'watch',preview:true}));}
   }
   for(const [key,p]of this.peers)if(p.outgoing&&!p.preview&&(p.pc.iceConnectionState==='failed'||p.pc.iceConnectionState==='disconnected')&&Date.now()-p.restartAt>10_000){
    if(p.retries>=3){this.close(key);continue;}p.restartAt=Date.now();p.retries++;await this.offer(p,true);
   }
   this.balanceTracks();
  }finally{this.maintaining=false;}
 }
 departed(id:string){
  this.close(this.key(id,true));this.close(this.key(id,false));
  if(this.snapshot&&activeStreams(this.snapshot).some(s=>s.broadcaster_id===id&&s.session_id===this.selected))this.clearRemote();this.emit();
 }
 async sample(diagnostics=false){
  const peers=[...this.peers.values()].filter(p=>!p.preview&&(diagnostics||p.outgoing));
  if(this.disposed||this.statisticsRunning||!peers.length)return;this.statisticsRunning=true;
  try{
   const metrics=await Promise.all(peers.map(async p=>{
    const m=await collectStats(p.pc,p.id,p.counters);
    m.connection=p.connection;
    if(p.outgoing&&p.pc.connectionState==='connected'){
     const target=videoProfile(this.profile),congested=m.limitation==='bandwidth'||(m.rtt??0)>0.35;
     const next=congested?Math.max(target.minBitrate,p.bitrate-200_000):Math.min(target.bitrate,p.bitrate+100_000);
     if(next!==p.bitrate){p.bitrate=next;await Promise.all(p.pc.getSenders().map(s=>tuneSender(s,next,this.profile).catch(()=>undefined)));}
    }return m;
   }));if(!this.disposed&&diagnostics)this.metrics(metrics);
  }catch{/* Closing peers can invalidate stats. */}finally{this.statisticsRunning=false;}
 }
 dispose(){this.disposed=true;this.stopLocal();for(const key of this.peers.keys())this.close(key);this.clearRemote();this.previews.clear();this.metrics([]);}
}
