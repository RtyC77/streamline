import {afterEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ShareOptions} from '../src/components/ShareOptions';
import {RoomPage} from '../src/pages/RoomPage';
import {validStill} from '../src/media/still';
afterEach(()=>vi.unstubAllGlobals());
describe('Compartilhamento e seleção',()=>{
 it('oferece áudio do sistema desmarcado e avisa sobre outros aplicativos',()=>{
  const html=renderToStaticMarkup(<ShareOptions onClose={()=>{}} onShare={()=>{}}/>);
  expect(html).toContain('Compartilhar áudio do sistema');expect(html).toContain('YouTube');expect(html).not.toContain('checked=""');
  const opted=renderToStaticMarkup(<ShareOptions initial={{resolution:480,fps:24,systemAudio:true}} onClose={()=>{}} onShare={()=>{}}/>);expect(opted).toContain('checked=""');
 });
 it('oferece as novas resoluções e taxas de quadros e avisa sobre configurações pesadas',()=>{
  const html=renderToStaticMarkup(<ShareOptions onClose={()=>{}} onShare={()=>{}}/>);
  for(const value of [480,720,1080,24,30,48,60])expect(html).toContain(`value="${value}"`);
  expect(html).toContain('Escolher janela e compartilhar');
  expect(html).not.toContain('extremamente pesada');
  for(const initial of [{resolution:1080,fps:30},{resolution:720,fps:48},{resolution:720,fps:60}] as const){
   const heavy=renderToStaticMarkup(<ShareOptions initial={initial} onClose={()=>{}} onShare={()=>{}}/>);
   expect(heavy).toContain('role="alert"');
   expect(heavy).toContain('extremamente pesada');
  }
 });
 it('mostra três telas selecionáveis sem criar três players ao vivo',()=>{
  vi.stubGlobal('window',{isSecureContext:false});vi.stubGlobal('location',{origin:'https://example.com'});
  const html=renderToStaticMarkup(<RoomPage self="a" invite="abc" onLeave={()=>{}} initial={{room:{id:'room',name:'Sala',created_by:'a',channel_epoch:'epoch',expires_at:'2099-01-01',broadcaster_id:null,stream_session:null},members:['a','b','c'].map(user_id=>({user_id,client_id:user_id,nickname:`Pessoa ${user_id}`})),streams:['a','b','c'].map(broadcaster_id=>({broadcaster_id,session_id:broadcaster_id}))}}/>);
  expect(html.match(/class="stream-tile/g)).toHaveLength(3);expect(html).not.toContain('<video');expect(html).toContain('Prévia indisponível');
 });
 it('recusa imagem grande ou conteúdo de outro tipo no canal de prévias',()=>{
  expect(validStill('data:image/jpeg;base64,YQ==')).toBe(true);
  expect(validStill('data:image/svg+xml;base64,YQ==')).toBe(false);
  expect(validStill('data:image/jpeg;base64,'+'a'.repeat(60000))).toBe(false);
 });
});
