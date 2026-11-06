import {lazy,Suspense,useState} from 'react';
import {Icon} from './Icon';
const AdminPanel=lazy(()=>import('./AdminPanel').then(m=>({default:m.AdminPanel})));
export function AdminEntry(){const [open,setOpen]=useState(false);return <><button className="icon-button admin-entry" onClick={()=>setOpen(true)}><Icon name="lock" size={15}/>Administração</button>{open&&<Suspense fallback={<span role="status">Abrindo administração…</span>}><AdminPanel onClose={()=>setOpen(false)}/></Suspense>}</>;}
