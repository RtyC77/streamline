export function TransitionCover({poster,failed=false}:{poster?:string;failed?:boolean}){
 return <div className="transition-cover" role="status">{poster&&<img src={poster} alt="Imagem congelada da tela selecionada"/>}<span>{failed?'Transmissão indisponível. Escolha uma tela para tentar novamente.':'Conectando à tela…'}</span></div>;
}
