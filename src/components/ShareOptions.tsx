import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icon';
import {captureFrameRates,captureResolutions,defaultProfile,videoProfile,type CaptureProfile} from '../media/profile';
export function ShareOptions({onClose,onShare,onQuality,initial=defaultProfile}:{onClose:()=>void;onShare:(profile:CaptureProfile)=>void;onQuality?:(profile:CaptureProfile)=>void;initial?:CaptureProfile}){
 const ref=useRef<HTMLDialogElement>(null);const [profile,setProfile]=useState<CaptureProfile>(initial);
 useEffect(()=>{ref.current?.showModal();},[]);const target=videoProfile(profile);
 return <dialog ref={ref} onCancel={onClose} aria-labelledby="share-title"><div className="dialog-head"><h2 id="share-title">{onQuality ? 'Editar transmissão' : 'Compartilhar tela'}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar opções de compartilhamento"><Icon name="close"/></button></div>
 <form onSubmit={e=>{e.preventDefault();onShare(profile);}} className="share-options">
 <label htmlFor="share-resolution">Resolução</label><select id="share-resolution" value={profile.resolution} onChange={e=>setProfile({...profile,resolution:Number(e.target.value) as CaptureProfile['resolution']})}>{captureResolutions.map(resolution=><option key={resolution} value={resolution}>{resolution === 1080 ? '1080p (1920 × 1080)' : `${resolution}p${resolution === 480 ? ' · menor consumo' : ''}`}</option>)}</select>
 <label htmlFor="share-fps">Quadros por segundo</label><select id="share-fps" value={profile.fps} onChange={e=>setProfile({...profile,fps:Number(e.target.value) as CaptureProfile['fps']})}>{captureFrameRates.map(fps=><option key={fps} value={fps}>{fps} FPS{fps === 24 ? ' · menor consumo' : ''}</option>)}</select>
 {(profile.resolution === 1080 || profile.fps >= 48) && <p className="share-performance-warning" role="alert">Esta configuração é extremamente pesada para compartilhamento e exige mais do computador e da conexão.</p>}
 <label className="toggle-row" htmlFor="share-system-audio"><span><strong>Compartilhar áudio do sistema</strong><small>{onQuality ? 'Aplicado ao escolher outra tela.' : 'Inclui tela inteira e janelas, quando o navegador permitir.'}</small></span><input id="share-system-audio" type="checkbox" checked={profile.systemAudio===true} onChange={e=>setProfile({...profile,systemAudio:e.target.checked})} aria-describedby="system-audio-notice"/></label>
 <p id="system-audio-notice">Ao ativar, jogo, YouTube, notificações e outros sons do PC podem ser ouvidos. Habilite também o áudio no seletor do navegador. Desativado: áudio somente de uma aba compartilhada.</p>
 <p>Vídeo com teto inicial de {(target.bitrate/1_000_000).toLocaleString('pt-BR')} Mbps por espectador. O navegador pode reduzir a qualidade conforme a conexão.</p>
 <div className="share-option-actions">
 {onQuality && <button className="secondary wide" type="button" onClick={()=>onQuality({...profile,systemAudio:initial.systemAudio})}>Aplicar resolução e FPS</button>}
 <button className="primary wide" type="submit">{onQuality ? 'Escolher outra tela' : 'Escolher janela e compartilhar'}</button>
 </div></form></dialog>;
}
