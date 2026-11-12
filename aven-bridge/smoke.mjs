import {startBridge} from './server.mjs';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
const token=randomBytes(24).toString('hex'),app=startBridge({token,port:0,metadataTimeout:25000});
await once(app.server,'listening');const base=`http://127.0.0.1:${app.server.address().port}`;const headers={Authorization:`Bearer ${token}`};
try{
 const r=await fetch(base+'/files/08ada5a7a6183aae1e09d831df6748d566095a10',{headers,signal:AbortSignal.timeout(30000)});const list=await r.json();console.log(JSON.stringify({stage:'metadata',status:r.status,result:list}));
 const index=list.files?.findIndex(f=>f.playable);
 if(index>=0){const media=await fetch(base+'/video/08ada5a7a6183aae1e09d831df6748d566095a10/'+index,{headers:{...headers,Range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});console.log(JSON.stringify({stage:'media',status:media.status,bytes:(await media.arrayBuffer()).byteLength}));}
}catch(e){console.log(JSON.stringify({error:e.message}));}finally{await app.close();}
