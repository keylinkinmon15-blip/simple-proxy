import http from 'node:http';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const CACHE_MS=180000, TIMEOUT_MS=45000;
const cache=new Map();
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Content-Type':'application/json; charset=utf-8'};
export const manifest={
 id:'com.aven.cinema.public.en.hd4k',version:'3.0.1',name:'AVEN Cinema • English HD–4K',
 description:'Movie and TV catalog, metadata, search, and English 720p–4K direct video streams from configured authorized sources. A movie poster does not guarantee a stream.',
 types:['movie','series'],resources:['catalog','meta','stream'],idPrefixes:['tt'],
 catalogs:[
  {type:'movie',id:'aven-top',name:'AVEN • Movies',extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]},
  {type:'series',id:'aven-top',name:'AVEN • TV Shows',extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]}
 ],
 behaviorHints:{configurable:false,configurationRequired:false,p2p:false}
};
const validId=/^tt\d{5,12}(?::\d{1,4}:\d{1,5})?$/;
const str=(v)=>String(v??'').slice(0,1024);
export function quality(stream){
 const s=[stream.name,stream.title,stream.filename,stream.behaviorHints?.filename].filter(Boolean).map(str).join(' ').toLowerCase();
 if(/\b(?:2160p?|4k|uhd|3840x2160)\b/.test(s))return 2160;
 if(/\b(?:1440p?|2560x1440|2k)\b/.test(s))return 1440;
 if(/\b(?:1080p?|full[\s-]?hd|fhd|1920x1080)\b/.test(s))return 1080;
 if(/\b(?:720p?|1280x720|hd)\b/.test(s))return 720;
 return 0;
}
export function english(stream){
 const declarations=[stream.languages,stream.language,stream.lang,stream.audioLanguages].flat().filter(Boolean).map(x=>str(x).trim().toLowerCase());
 if(declarations.length)return declarations.length===1&&/^(en|eng|en-us|en-gb|english|english\s*\(us\)|english\s*\(uk\))$/.test(declarations[0]);
 const s=[stream.name,stream.title,stream.behaviorHints?.filename].filter(Boolean).map(str).join(' ');
 if(/\b(non[- ]?english|multi(?:language|audio)?|dual[- ]?audio|sub(?:bed|titles?)?\s*only|hindi|spanish|french|german|russian|portuguese|japanese|korean|arabic|italian|turkish|tamil|telugu)\b/i.test(s))return false;
 return /\b(english|eng|en[-_](?:us|gb)|en)\b/i.test(s)||/🇬🇧|🇺🇸/.test(s);
}
function directURL(stream){
 if(typeof stream.url!=='string'||!stream.url||stream.externalUrl||stream.infoHash||stream.ytId||stream.behaviorHints?.notWebReady)return false;
 try{
  const u=new URL(stream.url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!['localhost','127.0.0.1','::1'].includes(u.hostname);
 }catch{return false}
}
export function filterStreams(input){
 const urls=new Set(),results=[];
 for(const s of Array.isArray(input)?input:[]){
  if(!s||typeof s!=='object'||!directURL(s)||!english(s))continue;
  const q=quality(s);if(!q||urls.has(s.url))continue;urls.add(s.url);
  results.push({name:'AVEN • '+str(s.provider||s.name||'Video').replace(/\s+/g,' ').trim().slice(0,65),title:'English • '+(q===2160?'4K':q+'p')+' • Direct',url:s.url,behaviorHints:{...s.behaviorHints,notWebReady:false},_q:q});
 }
 return results.sort((a,b)=>b._q-a._q).map(({_q,...rest})=>rest);
}
export function providers(env=process.env){
 let input=[];try{input=JSON.parse(env.AVEN_SOURCE_ADDONS||'[]')}catch{return []}
 if(!Array.isArray(input))return [];
 return input.slice(0,8).flatMap(item=>{
  const src=typeof item==='string'?{manifestUrl:item}:item;
  if(!src||typeof src.manifestUrl!=='string')return [];
  try{
   const u=new URL(src.manifestUrl);
   if(u.protocol!=='https:'||u.username||u.password||u.port||!u.pathname.endsWith('/manifest.json'))return [];
   if(!/^[a-z][a-z0-9.-]*[a-z0-9]$/i.test(u.hostname)||u.hostname.includes('..')||/^(localhost|.*\.local|.*\.internal)$/.test(u.hostname)||/^\d+(\.\d+){3}$/.test(u.hostname))return [];
   return [{name:str(src.name||u.hostname).slice(0,50),base:u.href.slice(0,-'manifest.json'.length)}];
  }catch{return []}
 });
}
async function remoteJSON(url,fetcher=fetch){
 const cached=cache.get(url);if(cached&&cached.exp>Date.now())return cached.data;
 const response=await fetcher(url,{signal:AbortSignal.timeout(TIMEOUT_MS),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Upstream HTTP '+response.status);
 const text=await response.text();if(text.length>2_000_000)throw Error('Upstream response too large');
 const data=JSON.parse(text);cache.set(url,{data,exp:Date.now()+CACHE_MS});
 if(cache.size>200)cache.delete(cache.keys().next().value);
 return data;
}
async function collectStreams(type,id,opts={}){
 const configured=providers(opts.env);
 if(!['movie','series'].includes(type)||!validId.test(id))return {streams:[],diagnostics:{configuredProviders:configured.length,acceptedStreams:0,error:'Invalid title ID'}};
 const found=await Promise.allSettled(configured.map(async p=>{
  const data=await remoteJSON(p.base+'stream/'+type+'/'+encodeURIComponent(id)+'.json',opts.fetcher||fetch);
  return (Array.isArray(data.streams)?data.streams:[]).map(s=>({...s,provider:p.name}));
 }));
 const raw=found.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 const streams=filterStreams(raw);
 const diagnostics={
  configuredProviders:configured.length,
  respondingProviders:found.filter(r=>r.status==='fulfilled').length,
  failedProviders:found.filter(r=>r.status==='rejected').length,
  candidates:raw.length,
  directUrlCandidates:raw.filter(directURL).length,
  labeled720pOrHigher:raw.filter(s=>quality(s)>=720).length,
  labeledEnglish:raw.filter(english).length,
  acceptedStreams:streams.length,
  providerResults:found.map((r,i)=>({name:configured[i].name,status:r.status==='fulfilled'?'responded':'failed',candidates:r.status==='fulfilled'?r.value.length:0,reason:r.status==='rejected'?'Upstream unavailable or timed out':undefined}))
 };
 console.log('AVEN stream search',JSON.stringify({type,id,...diagnostics}));
 return {streams,diagnostics};
}
export async function getStreams(type,id,opts={}){
 const result=await collectStreams(type,id,opts);
 return {streams:result.streams};
}
export async function getCatalog(type,extra='',opts={}){
 if(!['movie','series'].includes(type))return {metas:[]};
 try{
  const data=await remoteJSON(CINEMETA+'/catalog/'+type+'/top'+(extra?'/'+extra:'')+'.json',opts.fetcher||fetch);
  return {metas:(Array.isArray(data.metas)?data.metas:[]).filter(x=>x&&typeof x.id==='string'&&validId.test(x.id)).slice(0,100)};
 }catch{return {metas:[]}}
}
export async function getMeta(type,id,opts={}){
 if(!['movie','series'].includes(type)||!validId.test(id))return {meta:null};
 try{const data=await remoteJSON(CINEMETA+'/meta/'+type+'/'+encodeURIComponent(id)+'.json',opts.fetcher||fetch);return {meta:data.meta||null}}catch{return {meta:null}}
}
function json(res,status,data,head=false){
 res.writeHead(status,{...headers,'Cache-Control':'public, max-age=120'});res.end(head?'':JSON.stringify(data));
}
export async function route(req,res,opts={}){
 if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return}
 if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'Read only'});return}
 const head=req.method==='HEAD',path=new URL(req.url||'/','http://localhost').pathname;
 if(path==='/manifest.json'){json(res,200,manifest,head);return}
 if(path==='/health'){json(res,200,{ok:true,version:manifest.version,name:manifest.name,sourceProviders:providers(opts.env).length,audioFilter:'English only',resolutionFilter:'720p–2160p',sourcePolicy:'direct URL only; no resolution/audio verification'},head);return}
 let diagnosticMatch=path.match(/^\/diagnostics\/stream\/(movie|series)\/(tt\d{5,12}(?::\d{1,4}:\d{1,5})?)\.json$/);
 if(diagnosticMatch){const result=await collectStreams(diagnosticMatch[1],diagnosticMatch[2],opts);json(res,200,result.diagnostics,head);return}
 if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end('<!doctype html><title>AVEN Cinema</title><body style="background:#0a0e16;color:#fff;font:18px system-ui;padding:2em"><h1>AVEN Cinema • English HD–4K</h1><p>Fusion / Stremio addon. Playable streams require configured authorized providers.</p><p><a style="color:#90cfff" href="/manifest.json">Add-on manifest</a></p></body>');return}
 let m=path.match(/^\/stream\/(movie|series)\/(tt\d{5,12}(?::\d{1,4}:\d{1,5})?)\.json$/);
 if(m){json(res,200,await getStreams(m[1],m[2],opts),head);return}
 m=path.match(/^\/meta\/(movie|series)\/(tt\d{5,12})\.json$/);
 if(m){json(res,200,await getMeta(m[1],m[2],opts),head);return}
 m=path.match(/^\/catalog\/(movie|series)\/aven-top(?:\/(.*))?\.json$/);
 if(m){
  const extra=m[2]||'';
  if(extra&&!/^(?:search=[^/]{1,120}|skip=\d{1,6})(?:&(?:search=[^/]{1,120}|skip=\d{1,6}))?$/.test(extra)){json(res,400,{error:'Invalid catalog filter'},head);return}
  json(res,200,await getCatalog(m[1],extra,opts),head);return;
 }
 json(res,404,{error:'Not found'},head);
}
export function startServer({port=Number(process.env.PORT||8099),host='0.0.0.0',fetcher=fetch,env=process.env}={}){
 const server=http.createServer((req,res)=>route(req,res,{fetcher,env}).catch(()=>json(res,502,{error:'Upstream temporarily unavailable'})));server.listen(port,host);return server;
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){startServer();console.log('AVEN Cinema HD–4K ready')}
