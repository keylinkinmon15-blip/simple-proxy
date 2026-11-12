import WebTorrent from 'webtorrent';import {randomBytes} from 'node:crypto';import {once} from 'node:events';import assert from 'node:assert/strict';import {startBridge} from './server.mjs';
const seed=new WebTorrent({dht:false,tracker:false,lsd:false,natUpnp:false,natPmp:false,utp:false});seed.on('error',()=>{});
const payload=randomBytes(32768);const torrent=await new Promise(r=>seed.seed(payload,{name:'fixture.mp4',announce:[]},r));
const receiver=new WebTorrent({dht:false,tracker:false,lsd:false,natUpnp:false,natPmp:false,utp:false});
receiver.on('add',t=>t.once('infoHash',()=>t.addPeer(`127.0.0.1:${seed.torrentPort}`)));
const token=randomBytes(24).toString('hex');const app=startBridge({token,port:0,client:receiver,allowedHashes:[torrent.infoHash],metadataTimeout:10000});await once(app.server,'listening');
try{const url=`http://127.0.0.1:${app.server.address().port}/video/${torrent.infoHash}/0`;const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Range:'bytes=10-1009'},signal:AbortSignal.timeout(15000)});if(r.status!==206)throw Error(await r.text());const bytes=Buffer.from(await r.arrayBuffer());assert.deepEqual(bytes,payload.subarray(10,1010));console.log('PASS: real BitTorrent peer transfer -> authenticated HTTP byte range; 1000 bytes match');}finally{await app.close();await new Promise(r=>seed.destroy(r));}
