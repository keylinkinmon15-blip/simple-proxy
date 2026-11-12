import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {startBridge,rangeOf} from './server.mjs';
const hash='a'.repeat(40),token='t'.repeat(32);
class Engine extends EventEmitter{
 add(){const t=new EventEmitter();t.infoHash=hash;t.ready=true;t.files=[{name:'demo.mp4',length:100,deselect(){},createReadStream({start,end}){return Readable.from([Buffer.alloc(end-start+1,7)]);}}];t.destroy=()=>{t.destroyed=true;};queueMicrotask(()=>t.emit('ready'));return t;}
 destroy(cb){cb();}
}
test('range requests handle suffixes, clipping and malformed input',()=>{assert.deepEqual(rangeOf('bytes=-10',100),{start:90,end:99,status:206});assert.equal(rangeOf('bytes=50-200',100).end,99);for(const h of ['bytes=100-','bytes=3-1','bytes=1-2,4-5','bytes=-0'])assert.throws(()=>rangeOf(h,100));});
test('HTTP auth, allowlist, byte ranges, HEAD and cap',async()=>{
 const app=startBridge({token,port:0,client:new Engine(),allowedHashes:[hash],cap:25});await once(app.server,'listening');const base=`http://127.0.0.1:${app.server.address().port}`;const headers={Authorization:`Bearer ${token}`};
 try{
 assert.equal((await fetch(base+'/status')).status,401);
 assert.equal((await fetch(base+'/files/'+ 'b'.repeat(40),{headers})).status,404);
 const list=await(await fetch(base+'/files/'+hash,{headers})).json();assert.equal(list.files[0].playable,true);
 const url=base+'/video/'+hash+'/0';const res=await fetch(url,{headers:{...headers,Range:'bytes=5-14'}});assert.equal(res.status,206);assert.equal(res.headers.get('content-range'),'bytes 5-14/100');assert.equal((await res.arrayBuffer()).byteLength,10);
 assert.equal((await fetch(url,{method:'HEAD',headers})).headers.get('content-length'),'100');
 assert.equal((await fetch(url,{headers:{...headers,Range:'bytes=100-'}})).status,416);
 await assert.rejects(async()=>{const r=await fetch(url,{headers});await r.arrayBuffer();});
 assert.equal((await fetch(base+'/video/'+hash+'/0',{headers})).status,429);
 }finally{await app.close();}
});
test('Fusion manifests, signed playback and cleaned provider names',async()=>{
 const app=startBridge({token,port:0,client:new Engine(),allowedHashes:[hash]});await once(app.server,'listening');const base=`http://127.0.0.1:${app.server.address().port}`;const realFetch=globalThis.fetch;
 globalThis.fetch=(url,...args)=>String(url).startsWith('https://aven-cinema-streams.onrender.com/')?Promise.resolve(new Response(JSON.stringify({streams:[{name:'MovieNerds N/A\nEnglish',title:'https://example.invalid . player',url:'https://example.invalid/video.mp4'}]}),{headers:{'Content-Type':'application/json'}})):realFetch(url,...args);
 try{
  const manifest=await(await fetch(base+'/manifest.json')).json();assert.deepEqual(manifest.resources,['stream']);
  const result=await(await fetch(base+'/stream/series/tt31260386:2:9.json')).json();assert.equal(result.streams[0].name,'AVEN • MovieNerds');assert.equal(result.streams[0].title,'English • Source 1');
  const demo=await(await fetch(base+'/bridge/stream/movie/tt1727587.json')).json();const path=new URL(demo.streams[0].url).pathname;
  assert.equal((await fetch(base+path.replace(/play\/[a-f0-9]+/,'play/'+ '0'.repeat(64)))).status,401);
  const valid=await fetch(base+path,{headers:{Range:'bytes=0-9'}});assert.equal(valid.status,206);assert.equal((await valid.arrayBuffer()).byteLength,10);
 }finally{globalThis.fetch=realFetch;await app.close();}
});
