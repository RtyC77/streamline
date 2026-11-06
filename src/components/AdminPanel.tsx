import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icon';
interface ActiveRoom {id:string;name:string;created_at:string;expires_at:string;participants:number;transmitting:boolean|null}
export function AdminPanel({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [username,setUsername]=useState('Admin'),[password,setPassword]=useState('');
 const [session,setSession]=useState<{token:string;expiresAt:number}|null>(null);const [rooms,setRooms]=useState<ActiveRoom[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{setSession(null);setRooms([]);setError('Sessão administrativa expirada. Entre novamente.');},Math.max(0,session.expiresAt*1000-Date.now()));return()=>clearTimeout(timer);},[session]);
 const call=async(body:object,token?:string)=>{
  const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error('Configure o Supabase para acessar a administração.');
  const response=await fetch(`${url}/functions/v1/admin-panel`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
  let data;try{data=await response.json();}catch{throw new Error('A função administrativa ainda não está disponível no Supabase.');}
  if(!response.ok){if(response.status===401&&token){setSession(null);setRooms([]);}throw new Error(data.error??'Não foi possível acessar a administração. Confira a publicação da Edge Function.');}return data;
 };
 const refresh=async(token:string)=>{const data=await call({action:'list'},token);setRooms(data.rooms);};
 const login=async()=>{if(busy)return;setBusy(true);setError('');try{const data=await call({action:'login',username,password});setSession(data);await refresh(data.token);}catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setPassword('');setBusy(false);}};
 const update=async()=>{if(!session||busy)return;setBusy(true);setError('');try{await refresh(session.token);}catch(e){setError(e instanceof Error?e.message:'Não foi possível atualizar.');}finally{setBusy(false);}};
 const closeRoom=async(room:ActiveRoom)=>{if(!session||busy||!window.confirm(`Finalizar ${room.name}? Todos os participantes serão desconectados.`))return;setBusy(true);setError('');try{await call({action:'close',roomId:room.id},session.token);await refresh(session.token);}catch(e){setError(e instanceof Error?e.message:'Não foi possível finalizar a sala.');}finally{setBusy(false);}};
 return <dialog className="admin-dialog" ref={dialog} onCancel={onClose} aria-labelledby="admin-title"><div className="dialog-head"><h2 id="admin-title">Administração</h2><button className="icon-button" onClick={onClose} aria-label="Fechar administração"><Icon name="close"/></button></div>
 {!session?<form onSubmit={e=>{e.preventDefault();void login();}}><label htmlFor="admin-user">Usuário</label><input id="admin-user" value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username" disabled={busy}/><label htmlFor="admin-password">Senha</label><input id="admin-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password" maxLength={256} disabled={busy}/><button className="primary wide" disabled={busy}>{busy?'Entrando…':'Entrar'}</button></form>:<><div className="admin-toolbar"><strong>{rooms.length} sala(s) ativa(s)</strong><button className="secondary" onClick={()=>void update()} disabled={busy}>Atualizar</button><button className="icon-button" onClick={()=>{setSession(null);setRooms([]);}} disabled={busy}>Sair</button></div><p>A lista é atualizada ao entrar, ao finalizar uma sala ou ao clicar em Atualizar.</p><div className="admin-rooms">{rooms.length===0?<p>Nenhuma sala ativa.</p>:rooms.map(room=><article key={room.id}><div><strong>{room.name}</strong><small>{room.id}</small><p>{room.participants} participante(s) · {room.transmitting?'Transmitindo':'Sem transmissão'}<br/>Criada em {new Date(room.created_at).toLocaleString('pt-BR')}</p></div><button className="danger" disabled={busy} onClick={()=>void closeRoom(room)}>Finalizar sala</button></article>)}</div></>}
 {error&&<div className="error" role="alert">{error}</div>}</dialog>;
}
