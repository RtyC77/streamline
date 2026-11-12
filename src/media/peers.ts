import type {MediaState,PeerMetric,Signal,SignalBody,Snapshot,SwitchTiming} from '../types';
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
 timing:SwitchTiming;
 economy:boolean; tuning:Promise<void>;
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
 private economy=false;
 private qualityPending=false;
 private disposed=false;
 private queues=new Map<string,Promise<void>>();
 private switching=false;
 private selectionTimer:ReturnType<typeof setTimeout>|null=null;
 private failedSelection:string|null=null;
 private selectionError:string|undefined;
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
  const incoming=[...this.peers.values()].find(p=>!p.outgoing&&!p.preview&&p.session===this.selected);
  let connectionIssue:string|undefined=this.selectionError;
  if(incoming&&incoming.pc.connectionState!=='connected'&&(incoming.pc.connectionState==='failed'||Date.now()-incoming.created>=15_000)){
   const relay=this.config.iceServers?.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/i.test(url)));
   connectionIssue=!incoming.pc.remoteDescription?'O transmissor ainda não respondeu à negociação. Confira a conexão dos dois participantes com a sala.':relay?'A conexão de mídia não foi estabelecida. Verifique o serviço TURN e a rede dos participantes.':'A conexão direta não foi estabelecida e esta sessão não tem TURN configurado. Algumas redes exigem TURN para assistir; atualizar a página não substitui essa configuração.';
  }
  const state:MediaState={sharing:!!this.stream,selected:this.selected,remote:this.remote,captureAudio:this.audio,
   switching:this.switching,switchTiming:incoming?.timing,
   connectionIssue,
   audio:this.remote?this.remoteAudio:this.audio,
   connections:[...this.peers.values()].filter(p=>p.outgoing&&!p.preview&&p.pc.connectionState==='connected').length,
   status:[...this.peers.values()].some(p=>!p.preview&&(p.pc.connectionState==='failed'||p.pc.connectionState==='disconnected'))?'Conexão perdida; tentando novamente':this.remote&&incoming?.pc.connectionState==='connected'?'Conexão de mídia estabelecida':this.stream?'Transmitindo':this.selected?'Conectando à tela':'Aguardando transmissão'};
  const old=this.lastState;
  if(old&&Object.keys(state).every(k=>state[k as keyof MediaState]===old[k as keyof MediaState]))return;
  this.lastState=state;this.update(state);
 }
 configure(config:RTCConfiguration){this.config=config;for(const p of this.peers.values())p.pc.setConfiguration(config);}
 private close(key:string){
  const p=this.peers.get(key);if(!p)return;
  this.peers.delete(key);if(p.iceTimer)clearTimeout(p.iceTimer);
  p.pc.ontrack=null;p.pc.onicecandidate=null;p.pc.onconnectionstatechange=null;p.pc.oniceconnectionstatechange=null;
  if(p.data){p.data.onopen=null;p.data.onmessage=null;p.data.onclose=null;p.data.close();}
  p.pc.close();this.balanceTracks();
 }
 private clearRemote(){this.remote?.getTracks().forEach(t=>t.stop());this.remote=null;this.remoteAudio='Sem trilha';}
 private cancelSelectionTimer(){if(this.selectionTimer)clearTimeout(this.selectionTimer);this.selectionTimer=null;}
 private current(p:Peer){return !this.disposed&&this.peers.get(this.key(p.id,p.outgoing))===p;}
 private armSelection(p:Peer){
  this.cancelSelectionTimer();this.switching=true;
  this.selectionTimer=setTimeout(()=>{if(this.current(p)&&p.session===this.selected)this.failSelection(p);},25_000);
 }
 private failSelection(p:Peer){
  this.cancelSelectionTimer();this.switching=false;this.failedSelection=p.session;
  const relay=this.config.iceServers?.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/i.test(url)));
  this.selectionError=!p.pc.remoteDescription?'O transmissor não respondeu. Escolha uma tela para tentar novamente.':!relay?'Não chegou imagem desta transmissão. Verifique a captura e a rede; esta sessão não tem TURN para redes que exigem relay. Escolha uma tela para tentar novamente.':'Não chegou imagem desta transmissão. Verifique a captura, a rede e o serviço TURN. Escolha uma tela para tentar novamente.';
  void this.send(this.envelope(p,{kind:'unwatch'})).catch(this.warn);this.close(this.key(p.id,false));this.clearRemote();this.emit();
 }
 requestSelect(session:string){
  if(this.disposed||this.switching)return false;
  if(session===this.selected&&this.failedSelection!==session)return false;
  if(!this.snapshot||!activeStreams(this.snapshot).some(s=>s.session_id===session))return false;
  this.select(session,true);this.connectSelected();return true;
 }
 firstFrame(session:string,stream:MediaStream){
  if(this.disposed||session!==this.selected||stream!==this.remote)return;
  const p=[...this.peers.values()].find(p=>!p.outgoing&&!p.preview&&p.session===session);
  if(!p||p.timing.firstFrameMs!==undefined)return;
  p.timing={...p.timing,firstFrameMs:Date.now()-p.created};this.cancelSelectionTimer();this.switching=false;this.emit();
 }
 private connectSelected(){
  const selected=this.snapshot&&activeStreams(this.snapshot).find(s=>s.session_id===this.selected&&s.broadcaster_id!==this.self);
  if(this.disposed||!selected||this.failedSelection===selected.session_id)return;
  const existing=this.peers.get(this.key(selected.broadcaster_id,false));if(existing&&!existing.preview)return;
  const p=this.create(selected.broadcaster_id,crypto.randomUUID(),selected.session_id,false);this.armSelection(p);this.emit();
  void this.send(this.envelope(p,{kind:'watch',economy:this.economy})).catch(error=>{if(this.current(p)){this.failSelection(p);this.warn(error);}});
 }
 setEconomy(enabled:boolean){
  this.economy=enabled;
  this.qualityPending=true;
 }
 private async sendQuality(){
  const p=[...this.peers.values()].find(peer=>!peer.outgoing&&!peer.preview&&peer.session===this.selected);
  if(!p||!this.qualityPending)return;
  this.qualityPending=false;
  try{await this.send(this.envelope(p,{kind:'viewer-quality',economy:this.economy}));}
  catch{this.qualityPending=true;}
 }
 private outgoingProfile(p:Peer):CaptureProfile{
  return p.economy?{...this.profile,resolution:480,fps:24}:this.profile;
 }
 private bitrateLimits(p:Peer){
  const profile=videoProfile(this.outgoingProfile(p));
  return p.economy?{bitrate:800_000,minBitrate:400_000}:profile;
 }
 private tunePeer(p:Peer){
  p.tuning=p.tuning.then(async()=>{
   if(!this.current(p)||!p.pc.remoteDescription)return;
   await Promise.all(p.pc.getSenders().map(sender=>tuneSender(sender,p.bitrate,this.outgoingProfile(p))));
  }).catch(()=>{if(this.current(p))this.warn(new Error('O navegador não aceitou todos os limites do encoder. Confira o diagnóstico.'));});
  return p.tuning;
 }
 setSnapshot(snapshot:Snapshot){
  if(this.disposed)return;this.snapshot=snapshot;const streams=activeStreams(snapshot);
  for(const session of this.previews)if(!streams.some(s=>s.session_id===session))this.previews.delete(session);
  if(this.stream&&!streams.some(s=>s.broadcaster_id===this.self&&s.session_id===this.localSession))this.stopLocal();
  for(const [key,p]of this.peers)if(!snapshot.members.some(m=>m.user_id===p.id)||!streams.some(s=>s.session_id===p.session&&s.broadcaster_id===(p.outgoing?this.self:p.id)))this.close(key);
  if(!streams.some(s=>s.session_id===this.selected))this.select(streams.find(s=>s.broadcaster_id!==this.self)?.session_id??streams[0]?.session_id??null);
  this.balanceTracks();this.emit();
 }
 select(session:string|null,retry=false){
  if(this.disposed||(session===this.selected&&!retry))return;
  if(session&&(!this.snapshot||!activeStreams(this.snapshot).some(s=>s.session_id===session)))return;
  for(const [key,p]of this.peers)if(!p.outgoing&&!p.preview){void this.send(this.envelope(p,{kind:'unwatch'})).catch(this.warn);this.close(key);}
  const sender=this.snapshot&&activeStreams(this.snapshot).find(s=>s.session_id===session);
  if(sender)this.close(this.key(sender.broadcaster_id,false));
  this.cancelSelectionTimer();this.failedSelection=null;this.selectionError=undefined;
  this.selected=session;this.switching=!!sender&&sender.broadcaster_id!==this.self;this.clearRemote();this.emit();
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
  const p:Peer={pc,id,outgoing,preview,connection,session,ice:[],pending:[],iceTimer:null,counters:new Map(),created:Date.now(),retries:0,restartAt:0,bitrate:videoProfile(this.profile).bitrate,negotiating:false,data:null,timing:{requestedMs:0},economy:false,tuning:Promise.resolve()};
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
  pc.onconnectionstatechange=()=>{
   if(!this.current(p))return;
   if(!outgoing&&!preview){
    if(pc.connectionState==='failed'){this.failSelection(p);return;}
    if(pc.connectionState==='connected'&&p.timing.connectedMs===undefined)p.timing={...p.timing,connectedMs:Date.now()-p.created};
    if(pc.connectionState==='disconnected'&&!this.selectionTimer)this.armSelection(p);
    if(pc.connectionState==='connected'&&p.timing.firstFrameMs!==undefined){this.cancelSelectionTimer();this.switching=false;}
   }
   if(preview&&pc.connectionState==='failed')this.close(key);this.emit();
  };
  pc.oniceconnectionstatechange=()=>{if(this.peers.get(key)===p)this.emit();};
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
  try{const offer=await p.pc.createOffer({iceRestart:restart});if(!this.current(p))return;await p.pc.setLocalDescription(offer);if(this.current(p)&&p.pc.localDescription?.sdp)await this.send(this.envelope(p,{kind:'offer',sdp:p.pc.localDescription.sdp}));}finally{p.negotiating=false;}
 }
 private async drain(p:Peer){for(const c of p.ice.splice(0))await p.pc.addIceCandidate(c);}
 receive(id:string,signal:Signal){
  const queueKey=`${id}:${signal.connection}`;
  const task=(this.queues.get(queueKey)??Promise.resolve()).then(async()=>{
   const snapshot=this.snapshot;if(this.disposed||!snapshot||!snapshot.members.some(m=>m.user_id===id&&m.client_id===signal.client))return;
   const streams=activeStreams(snapshot);
   if(signal.kind==='watch'){
    if(!this.stream||this.localSession!==signal.session||!streams.some(s=>s.broadcaster_id===this.self&&s.session_id===signal.session))return;
    const existing=this.peers.get(this.key(id,true));if(existing?.connection===signal.connection)return;
    const p=this.create(id,signal.connection,signal.session,true,signal.preview===true);
    p.economy=signal.economy===true;
    p.bitrate=this.bitrateLimits(p).bitrate;
    await this.offer(p);return;
   }
   if(signal.kind==='unwatch'){
    const p=this.peers.get(this.key(id,true));if(p?.connection===signal.connection&&p.session===signal.session)this.close(this.key(id,true));return;
   }
   const outgoing=signal.session===this.localSession;
   if(!streams.some(s=>s.session_id===signal.session&&s.broadcaster_id===(outgoing?this.self:id)))return;
   const p=this.peers.get(this.key(id,outgoing));if(!p||p.connection!==signal.connection||p.session!==signal.session)return;
   if(signal.kind==='viewer-quality'){
    if(outgoing&&!p.preview&&p.economy!==signal.economy){
     p.economy=signal.economy;
     p.bitrate=Math.min(p.bitrate,this.bitrateLimits(p).bitrate);
     await this.tunePeer(p);
    }
   }else if(signal.kind==='ice'||signal.kind==='ice-batch'){
    const candidates=signal.kind==='ice'?[signal.candidate]:signal.candidates;
    for(const c of candidates)if(p.pc.remoteDescription)await p.pc.addIceCandidate(c);else if(p.ice.length<64)p.ice.push(c);
   }else if(signal.kind==='offer'&&!outgoing){
    if(p.pc.signalingState!=='stable')return;
    p.timing={...p.timing,offerMs:Date.now()-p.created};this.emit();
    await p.pc.setRemoteDescription({type:'offer',sdp:signal.sdp});if(!this.current(p))return;await this.drain(p);if(!this.current(p))return;preferCodecs(p.pc);
    const answer=await p.pc.createAnswer();if(!this.current(p))return;
    await p.pc.setLocalDescription(answer);if(this.current(p)&&p.pc.localDescription?.sdp)await this.send(this.envelope(p,{kind:'answer',sdp:p.pc.localDescription.sdp}));
   }else if(signal.kind==='answer'&&outgoing&&p.pc.signalingState==='have-local-offer'){
    await p.pc.setRemoteDescription({type:'answer',sdp:signal.sdp});if(!this.current(p))return;await this.drain(p);if(!this.current(p))return;
    if(!p.preview)await this.tunePeer(p);
   }
  }).catch(e=>{if(!this.disposed)this.warn(e);});
  this.queues.set(queueKey,task);void task.then(()=>{if(this.queues.get(queueKey)===task)this.queues.delete(queueKey);});
 }
 async maintain(){
  if(this.disposed||!this.snapshot||this.maintaining)return;this.maintaining=true;
  try{
   const streams=activeStreams(this.snapshot);
   for(const [key,p]of this.peers)if(p.preview&&Date.now()-p.created>15_000)this.close(key);
   this.connectSelected();
   if(this.qualityPending)await this.sendQuality();
   // One temporary data-only connection at a time, once per unseen session.
   if(![...this.peers.values()].some(p=>!p.outgoing&&p.preview)){
    const next=streams.find(s=>s.broadcaster_id!==this.self&&s.session_id!==this.selected&&!this.previews.has(s.session_id));
    if(next){this.previews.add(next.session_id);const p=this.create(next.broadcaster_id,crypto.randomUUID(),next.session_id,false,true);await this.send(this.envelope(p,{kind:'watch',preview:true}));}
   }
   for(const [key,p]of this.peers)if(p.outgoing&&!p.preview&&(p.pc.iceConnectionState==='failed'||p.pc.iceConnectionState==='disconnected')&&Date.now()-p.restartAt>10_000){
    if(p.retries>=3){this.close(key);continue;}p.restartAt=Date.now();p.retries++;await this.offer(p,true);
   }
   this.balanceTracks();this.emit();
  }finally{this.maintaining=false;}
 }
 departed(id:string){
  this.close(this.key(id,true));this.close(this.key(id,false));
  if(this.snapshot&&activeStreams(this.snapshot).some(s=>s.broadcaster_id===id&&s.session_id===this.selected)){
   this.cancelSelectionTimer();this.switching=false;this.failedSelection=this.selected;this.selectionError='O transmissor desconectou. Escolha uma tela para tentar novamente.';this.clearRemote();
  }this.emit();
 }
 async sample(diagnostics=false){
  const peers=[...this.peers.values()].filter(p=>!p.preview&&(diagnostics||p.outgoing));
  if(this.disposed||this.statisticsRunning||!peers.length)return;this.statisticsRunning=true;
  try{
   const metrics=await Promise.all(peers.map(async p=>{
    const m=await collectStats(p.pc,p.id,p.counters);
    m.connection=p.connection;
    if(p.outgoing&&p.pc.connectionState==='connected'){
     const target=this.bitrateLimits(p),congested=m.limitation==='bandwidth'||(m.rtt??0)>0.35;
     const next=congested?Math.max(target.minBitrate,p.bitrate-200_000):Math.min(target.bitrate,p.bitrate+100_000);
     if(next!==p.bitrate){p.bitrate=next;await this.tunePeer(p);}
    }return m;
   }));if(!this.disposed&&diagnostics)this.metrics(metrics);
  }catch{/* Closing peers can invalidate stats. */}finally{this.statisticsRunning=false;}
 }
 dispose(){this.disposed=true;this.cancelSelectionTimer();this.switching=false;this.stopLocal();for(const key of this.peers.keys())this.close(key);this.clearRemote();this.previews.clear();this.queues.clear();this.metrics([]);}
}
