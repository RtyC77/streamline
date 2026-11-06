import {verifyPassword,issueToken,validToken} from './security.ts';
declare const Deno:{env:{get:(name:string)=>string|undefined};serve:(handler:(req:Request)=>Promise<Response>)=>void};
export async function handleAdmin(req:Request,env:{get:(name:string)=>string|undefined}):Promise<Response>{
 const origin=req.headers.get('origin')??'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers});
 if(!(env.get('ALLOWED_ORIGINS')??'').split(',').map(s=>s.trim()).includes(origin))return reply(403,{error:'Origem não autorizada.'});
 Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 try{
  const url=env.get('SUPABASE_URL'),secret=env.get('ADMIN_SESSION_SECRET'),hash=env.get('ADMIN_PASSWORD_HASH'),login=env.get('ADMIN_LOGIN');
  const key=JSON.parse(env.get('SUPABASE_SECRET_KEYS')||'{}').default||env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key||!secret||secret.length<32||!hash||!login)return reply(503,{error:'Administração ainda não configurada no Supabase.'});
  const text=await req.text();if(text.length>4096)return reply(413,{error:'Requisição muito grande.'});const body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Requisição inválida.'});
  const rpc=async(name:string,args:object={})=>{const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('database');return response.json();};
  if(body.action==='login'){
   if(typeof body.username!=='string'||typeof body.password!=='string'||body.username.length>80||body.password.length>256)return reply(400,{error:'Login inválido.'});
   if(!await rpc('admin_login_gate'))return reply(429,{error:'Limite de tentativas. Aguarde 15 minutos.'});
   const passwordValid=await verifyPassword(body.password,hash);
   if(body.username!==login||!passwordValid)return reply(401,{error:'Usuário ou senha incorretos.'});
   return reply(200,await issueToken(secret));
  }
  const token=(req.headers.get('authorization')??'').replace(/^Bearer /,'');
  if(token.length>256||!await validToken(token,secret))return reply(401,{error:'Sessão administrativa expirada. Entre novamente.'});
  if(body.action==='list')return reply(200,{rooms:await rpc('admin_list_rooms')});
  if(body.action==='close'&&typeof body.roomId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.roomId))return reply(200,{closed:await rpc('admin_close_room',{p_room:body.roomId})});
  return reply(400,{error:'Ação inválida.'});
 }catch{return reply(500,{error:'Não foi possível executar a operação. Confira a configuração administrativa.'});}
}
if(typeof Deno!=='undefined')Deno.serve(req=>handleAdmin(req,Deno.env));
