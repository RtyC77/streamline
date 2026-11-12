import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RoomCapacity} from '../src/components/RoomCapacity';
const mocks=vi.hoisted(()=>({rpc:vi.fn().mockResolvedValue({data:{},error:null})}));
vi.mock('../src/services/supabase',()=>({prepareClient:async()=>({rpc:mocks.rpc})}));
import {enter} from '../src/services/rooms';
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
describe('Capacidade da sala',()=>{
 it('mostra intervalo acessível e estimativa de upload de sete espectadores',()=>{
  const html=renderToStaticMarkup(<RoomCapacity value={8} onChange={()=>{}} disabled={false}/>);
  expect(html).toContain('min="2"');
  expect(html).toContain('max="8"');
  expect(html).toContain('21 Mbps');
  expect(html).not.toContain('Uso do Supabase e Cloudflare');
 });
 it('envia limite somente na criação, preservando a autoridade do convite na entrada',async()=>{
  vi.stubGlobal('sessionStorage',{getItem:()=>crypto.randomUUID()});
  await enter(' Rod ',undefined,8);
  expect(mocks.rpc).toHaveBeenLastCalledWith('create_room',expect.objectContaining({p_nickname:'Rod',p_max_members:8}));
  await enter('João','a'.repeat(64),2);
  expect(mocks.rpc).toHaveBeenLastCalledWith('join_room',expect.not.objectContaining({p_max_members:expect.anything()}));
 });
 it('recusa capacidade inválida antes de chamar o banco',()=>{
  for(const capacity of [1,9,2.5])expect(()=>enter('Rod',undefined,capacity)).toThrow('2 a 8');
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
