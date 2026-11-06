import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../supabase/functions/admin-panel/security.ts';
process.stdout.write('Digite a senha do administrador (entrada oculta):\n');
const terminal=createInterface({input:process.stdin,output:new Writable({write(_chunk,_encoding,done){done();}}),terminal:true});
try{
 const password=await terminal.question('');if(!password||password.length>256)throw new Error('Informe uma senha de até 256 caracteres.');
 const hash=await hashPassword(password);
 await writeFile('.env.admin.local',`ADMIN_LOGIN=Admin\nADMIN_PASSWORD_HASH=${hash}\nADMIN_SESSION_SECRET=${randomBytes(32).toString('hex')}\nALLOWED_ORIGINS=https://streamline-cfw.pages.dev\n`);
 process.stdout.write('Configuração criada em .env.admin.local (arquivo ignorado pelo Git).\n');
}finally{terminal.close();}
