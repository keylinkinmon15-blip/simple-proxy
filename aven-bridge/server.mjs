import http from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import WebTorrent from 'webtorrent';

export function rangeOf(header,size){
 if(!header)return {start:0,end:size-1,status:200};
 const m=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!m||(!m[1]&&!m[2]))throw Error('Invalid range');
 let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 let end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)throw Error('Unsatisfiable range');
 return {start,end,status:206};
}
export function startBridge({token=process.env.BRIDGE_TOKEN,port=Number(process.env.PORT||8099),host='127.0.0.1',cap=256*1024*1024,maxFile=200*1024*1024,metadataTimeout=45000,allowedHashes=['08ada5a7a6183aae1e09d831df6748d566095a10'],client}={}){
 if(!token||token.length<24)throw Error('Set BRIDGE_TOKEN to at least 24 characters');
 const engine=client||new WebTorrent({maxConns:12,downloadLimit:2*1024*1024,uploadLimit:32*1024,lsd:false,natUpnp:false,natPmp:false,tracker:{rtcConfig:false}});
 const allow=new Set(allowedHashes);
 const sign=(hash,index)=>createHmac('sha256',token).update(hash+'/'+index).digest('hex');let active=null,pending=null,used=0,blocked=false,lastActivity=Date.now();
 const requests=new Set();
 function charge(n){used+=n;if(used>cap){blocked=true;for(const res of requests)res.destroy();if(active&&!active.destroyed)active.destroy({destroyStore:true});}}
 engine.on('error',()=>{blocked=true;});
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
 function auth(req){const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));const expected=Buffer.from(token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
 async function load(hash){
  if(blocked)throw Error('Transfer cap reached');
  if(active&&active.infoHash!==hash)throw Error('One torrent at a time');
  if(pending)return pending;
  if(active?.ready)return active;
  pending=new Promise((resolve,reject)=>{
   const torrent=engine.add(hash,{deselect:true,destroyStoreOnDestroy:true,announce:['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce','wss://tracker.openwebtorrent.com']});active=torrent;
   const timer=setTimeout(()=>{reject(Error('No torrent metadata before timeout'));torrent.destroy({destroyStore:true});active=null;},metadataTimeout);
   torrent.on('download',charge);torrent.on('upload',charge);
   torrent.once('error',()=>{clearTimeout(timer);active=null;reject(Error('Torrent failed'));});
   torrent.once('ready',()=>{clearTimeout(timer);for(const f of torrent.files)f.deselect();resolve(torrent);});
  });
  try{return await pending;}finally{pending=null;}
 }
 const server=http.createServer(async(req,res)=>{
  try{
   res.setHeader('Access-Control-Allow-Origin','*');
   if(req.method==='OPTIONS')return res.writeHead(204,{'Access-Control-Allow-Methods':'GET,HEAD,OPTIONS'}).end();
   const origin=process.env.PUBLIC_ORIGIN||`https://${req.headers.host}`;
   if(req.url==='/manifest.json')return json(res,200,{id:'com.aven.cinema.clean',version:'0.1.0',name:'AVEN Cinema Streams',description:'Direct HTTP sources with clean labels. Includes a separate Sintel torrent-bridge experiment.',types:['movie','series'],resources:['stream'],idPrefixes:['tt','tmdb:'],catalogs:[],behaviorHints:{configurable:false,configurationRequired:false}});
   if(req.url==='/bridge/manifest.json')return json(res,200,{id:'com.aven.cinema.bridge.demo',version:'0.1.0',name:'AVEN Torrent Bridge Test',description:'Sintel demo only. Internet torrent delivery is experimental.',types:['movie'],resources:['stream'],idPrefixes:['tt1727587'],catalogs:[]});
   if(req.url==='/bridge/stream/movie/tt1727587.json')return json(res,200,{streams:[{name:'AVEN • Torrent test',title:'Sintel • MP4 • Experimental',url:origin+'/play/'+sign(allowedHashes[0],0)+'/'+allowedHashes[0]+'/0'}]});
   if(/^\/stream\/(movie|series)\/[^/]+\.json$/.test(req.url||'')){
    const upstream=await fetch('https://aven-cinema-streams.onrender.com/disabled=milkbox:milkbox.zapto.org,pressplay:pressplayx.to'+req.url,{signal:AbortSignal.timeout(25000)});
    if(!upstream.ok)return json(res,502,{streams:[],error:'Source service unavailable'});
    const data=await upstream.json();
    const streams=(data.streams||[]).map((stream,index)=>{const lines=String(stream.name||'').split('\n');const brand=lines[0].replace(/\bN\/A\b/g,'').trim();const lang=lines[1]&&lines[1]!=='N/A'?lines[1]:'';return {...stream,name:'AVEN • '+(brand||'Video'),title:[lang,'Source '+(index+1)].filter(Boolean).join(' • ')};});
    return json(res,200,{streams});
   }
   const play=/^\/play\/([a-f0-9]{64})\/([a-f0-9]{40})\/(\d+)$/.exec(req.url||'');
   if(play&&play[1]!==sign(play[2],Number(play[3])))return json(res,401,{error:'Invalid stream signature'});
   if(play)req.url='/video/'+play[2]+'/'+play[3];
   if(req.url==='/health')return json(res,200,{ok:!blocked});
   if(!play&&!auth(req))return json(res,401,{error:'Bearer token required'});
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Read-only API'});
   lastActivity=Date.now();
   if(req.url==='/status')return json(res,200,{used,cap,blocked,active:active?.infoHash||null,peers:active?.numPeers||0});
   const match=/^\/(files|video)\/([a-f0-9]{40})(?:\/(\d+))?$/.exec(req.url||'');
   if(!match||!allow.has(match[2]))return json(res,404,{error:'Unknown demo torrent'});
   if(blocked)return json(res,429,{error:'Process transfer cap reached'});
   const torrent=await load(match[2]);
   if(match[1]==='files')return json(res,200,{files:torrent.files.map((f,i)=>({index:i,name:f.name,bytes:f.length,playable:/\.mp4$/i.test(f.name)}))});
   const file=play&&Number(match[3])===0?torrent.files.find(f=>/\.mp4$/i.test(f.name)):torrent.files[Number(match[3])];
   if(!file||!/\.mp4$/i.test(file.name))return json(res,415,{error:'Choose an MP4 file; this prototype does not transcode'});
   if(file.length>maxFile)return json(res,413,{error:'File exceeds prototype storage limit'});
   if(requests.size)return json(res,409,{error:'One active playback request allowed'});
   let range;try{range=rangeOf(req.headers.range,file.length);}catch{return res.writeHead(416,{'Content-Range':`bytes */${file.length}`}).end();}
   const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':range.end-range.start+1,'Cache-Control':'no-store'};
   if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${file.length}`;
   res.writeHead(range.status,headers);if(req.method==='HEAD')return res.end();
   requests.add(res);
   const input=file.createReadStream({start:range.start,end:range.end});
   const meter=new Transform({transform(chunk,encoding,done){if(blocked||used+chunk.length>cap){blocked=true;done(Error('Transfer cap reached'));return;}charge(chunk.length);done(null,chunk);}});
   const idle=setTimeout(()=>input.destroy(Error('No media before timeout')),45000);
   input.once('data',()=>clearTimeout(idle));
   res.once('close',()=>input.destroy());
   try{await pipeline(input,meter,res);}catch{res.destroy();}finally{clearTimeout(idle);requests.delete(res);file.deselect();}
  }catch(error){if(!res.headersSent)json(res,503,{error:error.message});else res.destroy();}
 });
 const cleanup=setInterval(()=>{if(active&&!requests.size&&!pending&&Date.now()-lastActivity>120000){active.destroy({destroyStore:true});active=null;}},10000);cleanup.unref();
 server.listen(port,host);
 return {server,engine,close:async()=>{clearInterval(cleanup);for(const res of requests)res.destroy();await new Promise(r=>server.close(r));await new Promise(r=>engine.destroy(r));}};
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){
 const bridge=startBridge({host:process.env.RENDER?'0.0.0.0':'127.0.0.1',cap:16*1024*1024});console.log('AVEN demo bridge listening on localhost:8099');
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>bridge.close().then(()=>process.exit(0)));
}
