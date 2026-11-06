import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icon';
import {defaultProfile,videoProfile,type CaptureProfile} from '../media/profile';
export function ShareOptions({onClose,onShare,initial=defaultProfile}:{onClose:()=>void;onShare:(profile:CaptureProfile)=>void;initial?:CaptureProfile}){
 const ref=useRef<HTMLDialogElement>(null);const [profile,setProfile]=useState<CaptureProfile>(initial);
 useEffect(()=>{ref.current?.showModal();},[]);const target=videoProfile(profile);
 return <dialog ref={ref} onCancel={onClose} aria-labelledby="share-title"><div className="dialog-head"><h2 id="share-title">Compartilhar tela</h2><button className="icon-button" onClick={onClose} aria-label="Fechar opções de compartilhamento"><Icon name="close"/></button></div>
 <form onSubmit={e=>{e.preventDefault();onShare(profile);}} className="share-options">
 <label htmlFor="share-resolution">Resolução</label><select id="share-resolution" value={profile.resolution} onChange={e=>setProfile({...profile,resolution:Number(e.target.value) as 480|720})}><option value={480}>480p · menor consumo</option><option value={720}>720p</option></select>
 <label htmlFor="share-fps">Quadros por segundo</label><select id="share-fps" value={profile.fps} onChange={e=>setProfile({...profile,fps:Number(e.target.value) as 24|30})}><option value={24}>24 FPS · menor consumo</option><option value={30}>30 FPS</option></select>
 <label className="toggle-row" htmlFor="share-system-audio"><span><strong>Compartilhar áudio do sistema</strong><small>Inclui tela inteira e janelas, quando o navegador permitir.</small></span><input id="share-system-audio" type="checkbox" checked={profile.systemAudio===true} onChange={e=>setProfile({...profile,systemAudio:e.target.checked})} aria-describedby="system-audio-notice"/></label>
 <p id="system-audio-notice">Ao ativar, jogo, YouTube, notificações e outros sons do PC podem ser ouvidos. Habilite também o áudio no seletor do navegador. Desativado: áudio somente de uma aba compartilhada.</p>
 <p>Vídeo com teto inicial de {(target.bitrate/1_000_000).toLocaleString('pt-BR')} Mbps por espectador. O navegador pode reduzir a qualidade conforme a conexão.</p>
 <button className="primary wide" type="submit">Escolher janela e compartilhar</button></form></dialog>;
}
