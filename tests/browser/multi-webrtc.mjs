import {Peers} from '../../src/media/peers';
import {videoStill,firstStill} from '../../src/media/still';
const ids=Array.from({length:4},()=>crypto.randomUUID()),clients=ids.map(()=>crypto.randomUUID()),sessions=ids.slice(0,3).map(()=>crypto.randomUUID());
const snapshot={room:{id:crypto.randomUUID(),name:'Teste local',max_members:8,channel_epoch:crypto.randomUUID(),expires_at:'2099-01-01',broadcaster_id:null,stream_session:null},members:ids.map((id,i)=>({user_id:id,client_id:clients[i],nickname:`Pessoa ${i}`})),streams:sessions.map((session_id,i)=>({broadcaster_id:ids[i],session_id}))};
const managers=[],posters=new Map(),messages=[],warnings=[],checks=[];let selectedRemote=null;
const video=document.querySelector('video');
const render=()=>document.querySelector('#report').textContent=JSON.stringify({checks,messages:messages.length,warnings},null,2);
const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);render();};
const wait=async(predicate,label)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw new Error('Tempo excedido: '+label);await new Promise(r=>setTimeout(r,100));}};
const timers=[];let maintenance;
try{
 for(let i=0;i<4;i++)managers.push(new Peers(ids[i],clients[i],{iceServers:[]},async message=>{messages.push({sender:i,kind:message.kind,preview:message.preview});queueMicrotask(()=>managers[ids.indexOf(message.to)]?.receive(ids[i],message));},state=>{if(i===3&&state.remote!==selectedRemote){selectedRemote=state.remote;video.srcObject=state.remote;if(state.remote)void video.play().catch(()=>{});}},()=>{},e=>{warnings.push(String(e));render();},(session,image)=>{if(i===3)posters.set(session,image);}));
 managers.forEach(m=>m.setSnapshot(snapshot));
 for(let i=0;i<3;i++){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d');let frame=0;
  const draw=()=>{context.fillStyle=['#245844','#663838','#294363'][i];context.fillRect(0,0,320,180);context.fillStyle='white';context.font='30px sans-serif';context.fillText(`Tela ${i+1} · ${frame++}`,20,95);};draw();
  timers.push(setInterval(draw,100));const stream=canvas.captureStream(10);const poster=await firstStill(stream);check(!!poster,`Primeiro quadro capturado na fonte ${i+1}`);managers[i].setLocal(stream,sessions[i],'Mídia sintética sem áudio',{resolution:480,fps:24},poster);
  managers[i].select(sessions[i]);
 }
 maintenance=setInterval(()=>managers.forEach(m=>void m.maintain()),250);
 await wait(()=>video.readyState>=2&&video.videoWidth>0,'primeira transmissão');check(true,'Primeira tela recebida via WebRTC nativo');
 await wait(()=>posters.size>=2,'duas prévias');check(true,'Duas prévias entregues por RTCDataChannel sem mídia contínua');
 const last=videoStill(video);check(!!last,'Último quadro capturado uma vez ao trocar de tela');
 managers[3].rememberPreview(sessions[0]);managers[3].select(sessions[1]);await wait(()=>video.readyState>=2&&video.videoWidth>0,'segunda transmissão');check(true,'Troca para a segunda tela funciona');
 managers[3].select(sessions[2]);await wait(()=>video.readyState>=2&&video.videoWidth>0,'terceira transmissão');check(true,'Troca para a terceira tela funciona');
 managers[0].select(sessions[1]);managers[1].select(sessions[0]);
 await new Promise(r=>setTimeout(r,1500));
 const peerMaps=managers.map(m=>[...m.peers.values()]);
 check(peerMaps[3].filter(p=>!p.outgoing&&!p.preview&&!['closed','failed'].includes(p.pc.connectionState)).length===1,'Espectador mantém apenas um receptor de mídia ao vivo');
 check(peerMaps[0].some(p=>!p.outgoing&&!p.preview&&p.pc.connectionState==='connected')&&peerMaps[1].some(p=>!p.outgoing&&!p.preview&&p.pc.connectionState==='connected'),'Duas pessoas transmitem e assistem uma à outra simultaneamente');
 check(peerMaps.every(list=>list.filter(p=>!p.preview).every(p=>p.pc.connectionState==='connected')),'Conexões de mídia estabelecidas com transportes nativos');
 check(messages.filter(m=>m.kind==='ice-batch').length>0,'Candidatos ICE enviados em lotes');
 managers.forEach(m=>m.dispose());check(peerMaps.flat().every(p=>p.pc.connectionState==='closed'),'Conexões encerradas ao sair');
 document.querySelector('#status').textContent='PASSOU — WebRTC real no mesmo navegador, mídia sintética, sem teste entre PCs ou áudio.';render();
}catch(error){document.querySelector('#status').textContent='FALHOU: '+error;warnings.push(String(error));render();}finally{clearInterval(maintenance);timers.forEach(clearInterval);managers.forEach(m=>m.dispose());}
