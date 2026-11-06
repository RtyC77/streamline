const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
function equal(a:Uint8Array,b:Uint8Array){let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a[i]^(b[i]??0);return diff===0;}
export async function hashPassword(password:string,salt=crypto.getRandomValues(new Uint8Array(16))){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},key,256);
 return `pbkdf2-sha256$600000$${encode(salt)}$${encode(new Uint8Array(hash))}`;
}
export async function verifyPassword(password:string,stored:string){
 try{const [kind,count,salt,hash]=stored.split('$');if(kind!=='pbkdf2-sha256'||count!=='600000'||decode(salt).length!==16||decode(hash).length!==32)return false;
 const actual=await hashPassword(password,decode(salt));return equal(decode(actual.split('$')[3]),decode(hash));}catch{return false;}
}
async function sign(value:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));}
export async function issueToken(secret:string){const expires=Math.floor(Date.now()/1000)+900;const data=`SLAdmin.${expires}.${encode(crypto.getRandomValues(new Uint8Array(16)))}`;return {token:`${data}.${encode(await sign(data,secret))}`,expiresAt:expires};}
export async function validToken(token:string,secret:string){try{const parts=token.split('.');if(parts.length!==4||parts[0]!=='SLAdmin'||!/^[0-9]{10,12}$/.test(parts[1])||!/^[A-Za-z0-9_-]{22}$/.test(parts[2]))return false;
 const expires=Number(parts[1]),now=Math.floor(Date.now()/1000);if(expires<=now||expires>now+900)return false;return equal(await sign(parts.slice(0,3).join('.'),secret),decode(parts[3]));}catch{return false;}}
