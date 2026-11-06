import { target } from '../config';
export const DEFAULT_CAPACITY = 2;
export function RoomCapacity({value,onChange,disabled}:{value:number;onChange:(value:number)=>void;disabled:boolean}) {
 const impact=value<=3?'Baixo':value<=5?'Moderado':'Alto';
 const upload=((value-1)*target.bitrate/1_000_000).toLocaleString('pt-BR');
 return <fieldset className="room-capacity" disabled={disabled}>
  <div className="capacity-title"><label htmlFor="room-capacity">Limite de pessoas</label><output htmlFor="room-capacity">{value} pessoas</output></div>
  <input id="room-capacity" type="range" min={2} max={8} step={1} value={value} onChange={e=>onChange(Number(e.target.value))} aria-describedby="capacity-impact capacity-details"/>
  <div className="capacity-scale"><span>2 · Menor uso</span><span>8 · Maior uso</span></div>
  <p id="capacity-impact"><strong>Impacto estimado: {impact.toLowerCase()}</strong> · inclui você</p>
  <p id="capacity-details">Com a sala cheia, vídeo a 3 Mbps pode somar cerca de <strong>{upload} Mbps de upload do transmissor</strong>, mais áudio e tráfego de rede.</p>
  <details><summary>Uso do Supabase e Cloudflare</summary><p>Mais pessoas conectadas geram mais presença e sinalização no Supabase. Uma sala cheia com um transmissor faz aproximadamente {180+(value-1)*120} renovações de participação por hora, além das ações e reconexões.</p><p>O vídeo e o áudio seguem diretamente entre os participantes. O Cloudflare entrega os arquivos do site. Vagas vazias não criam conexões ou consultas. Estes valores são estimativas, não medições nem previsão de cobrança.</p></details>
 </fieldset>;
}
