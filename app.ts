import { createServer, type Socket, type Server } from 'node:net';
import { store } from './store.ts';
import { handleInfoRefs, handleUploadPack, handleReceivePack } from './gitproto.ts';
import { handleRest, cachedIssueReply } from './rest.ts';
import { handleGraphQL } from './graphql.ts';
import { handleMCP } from './mcp.ts';

const JSON_TYPE='application/json; charset=utf-8';
let requestCounter=0;
let cachedDate:{second:number;text:string}|undefined;
const EMPTY_PARAMS=new URLSearchParams();
export type DispatchReply={status:number;headers:Record<string,string>;body:string|Buffer};
function json(status:number,value:unknown,headers:Record<string,string>={}):DispatchReply{const body=`${JSON.stringify(value)}\n`;return {status,headers:{'content-type':JSON_TYPE,'content-length':String(Buffer.byteLength(body)),...headers},body};}
function restReply(status:number,body:string,headers:Record<string,string>={},pre?:{buf:Buffer;len:number}):DispatchReply{return {status,headers:{'content-type':JSON_TYPE,'content-length':String(pre?pre.len:Buffer.byteLength(body)),'X-GitHub-Request-Id':`req-${++requestCounter}`,...headers},body:pre?pre.buf:body};}
function send(r:{status:number;contentType:string;body:Buffer}):DispatchReply{return {status:r.status,headers:{'content-type':r.contentType,'content-length':String(r.body.length)},body:r.body};}
function serviceParam(rawQuery:string):string{if(rawQuery.includes('%')||rawQuery.includes('+'))return new URLSearchParams(rawQuery).get('service')??'';for(const part of rawQuery.split('&')){if(part==='service')return '';if(part.startsWith('service='))return part.slice(8);}return '';}
function decSeg(s:string):string{return s.includes('%')?decodeURIComponent(s):s;}
function fastIssueGet(path:string,ghHeaders:Record<string,string>,headers:Record<string,string>):DispatchReply|undefined{
 if(path.includes('%'))return undefined;
 const parts=path.split('/');
 if(parts.length!==8||parts[1]!=='api'||parts[2]!=='v3'||parts[3]!=='repos'||parts[6]!=='issues')return undefined;
 const owner=parts[4]!,name=parts[5]!,numText=parts[7]!;
 if(!owner||!name||!/^\d+$/.test(numText))return undefined;
 const r=store.repo(owner,name);if(!r)return undefined;
 const n=Number(numText);if(!r.issues.has(n))return undefined;
 const hit=cachedIssueReply(store,owner,name,n,String(headers.host||'localhost'));if(!hit)return undefined;
 return restReply(200,hit.body,ghHeaders,{buf:hit.buf,len:hit.len});
}
export function dispatch(method:string,target:string,headers:Record<string,string>,body:Buffer):DispatchReply{
 const queryAt=target.indexOf('?'),path=(queryAt<0?target:target.slice(0,queryAt))||'/',rawQuery=queryAt<0?'':target.slice(queryAt+1);
 if(method==='GET'&&path==='/healthz')return json(200,{status:'ok'});
 if(path==='/mcp'&&method==='POST'){if(!/^Bearer\s+\S/.test(headers.authorization??''))return json(401,{message:'Requires authentication'});const result=handleMCP(store,body,String(headers.host||'localhost'));return {status:result.status,headers:{'content-type':JSON_TYPE,'content-length':String(Buffer.byteLength(result.body)),...result.headers},body:Buffer.from(result.body)};}
 if(path==='/api/graphql'&&method==='POST'){const ghHeaders={'X-GitHub-Request-Id':`req-${++requestCounter}`};if(!/^Bearer\s+\S/.test(headers.authorization??''))return restReply(401,JSON.stringify({message:'Requires authentication'}),ghHeaders);let parsed:unknown;try{parsed=JSON.parse(body.toString('utf8'));}catch{return restReply(400,JSON.stringify({message:'Problems parsing JSON'}),ghHeaders);}const result=handleGraphQL(store,parsed,String(headers.host||'localhost'));return restReply(result.status,result.body,ghHeaders);}
 if(path.startsWith('/api/v3')){const searchParams=queryAt<0?EMPTY_PARAMS:new URLSearchParams(rawQuery);const ghHeaders={'X-GitHub-Request-Id':`req-${++requestCounter}`,'X-OAuth-Scopes':'repo'};if(!/^Bearer\s+\S/.test(headers.authorization??''))return restReply(401,JSON.stringify({message:'Requires authentication'}),ghHeaders);let raw=Buffer.alloc(0),parsed:unknown={};if(method==='POST'||method==='PUT'||method==='PATCH'||method==='DELETE'){raw=body;const ct=String(headers['content-type']||'');if(raw.length&&/json/i.test(ct)){try{parsed=JSON.parse(raw.toString('utf8'));}catch{return restReply(400,JSON.stringify({message:'Problems parsing JSON'}),ghHeaders);}}}if(method==='GET'){const fl=fastIssueGet(path,ghHeaders,headers);if(fl)return fl;}const result=handleRest(store,method,path,searchParams,raw,parsed,String(headers.host||'localhost'));if(result)return restReply(result.status,result.body,{...ghHeaders,...result.headers},result.buf?{buf:result.buf,len:result.len!}:undefined);return restReply(404,JSON.stringify({message:'Not Found'}),ghHeaders);}
 if(!/^Bearer\s+\S/.test(headers.authorization??''))return json(401,{message:'Requires authentication'});
 const seg=path.split('/');
 let route='';if(seg.length===4&&(seg[3]==='git-upload-pack'||seg[3]==='git-receive-pack'))route=seg[3]!;else if(seg.length===5&&seg[3]==='info'&&seg[4]==='refs')route='info/refs';
 if(route!==''&&seg[0]===''&&seg[1]!==''&&seg[2]!==''){let nameRaw=seg[2]!;if(nameRaw.length>4&&nameRaw.endsWith('.git'))nameRaw=nameRaw.slice(0,-4);else if(nameRaw==='.git')nameRaw='.';const owner=decSeg(seg[1]!),name=decSeg(nameRaw);if(route==='info/refs'&&method==='GET'){const result=handleInfoRefs(store,owner,name,serviceParam(rawQuery),String(headers['git-protocol']??''));return result?send(result):json(404,{message:'Not Found'});}if(route==='git-upload-pack'&&method==='POST'){if(!store.repo(owner,name))return json(404,{message:'Not Found'});return send(handleUploadPack(store,owner,name,body,String(headers['git-protocol']??'')));}if(route==='git-receive-pack'&&method==='POST'){if(!store.repo(owner,name))return json(404,{message:'Not Found'});return send(handleReceivePack(store,owner,name,body));}}
 return json(404,{message:'Not Found'});
}

export type ParsedRequest={method:string;target:string;version:string;headers:Record<string,string>;body:Buffer;consumed:number;close:boolean};
export type ParseResult={request:ParsedRequest|null;error?:'bad'|'too-large';headersComplete:boolean};
const MAX_BODY=64*1024*1024;
export function requestTargetOf(buf:Buffer):string{const end=buf.indexOf('\r\n');if(end<0)return '';const line=buf.toString('latin1',0,end),parts=line.split(' ');return parts.length>=2?parts[1]||'':'';}
const TRIM_BYTES=new Set([9,10,11,12,13,32,160]);
function tryParseFast(buf:Buffer):ParseResult|undefined{
 const end=buf.indexOf('\r\n\r\n');if(end<0)return undefined;
 const lineEnd=buf.indexOf('\r\n'),line=buf.toString('latin1',0,lineEnd);
 const s1=line.indexOf(' ');if(s1<=0)return undefined;
 const s2=line.indexOf(' ',s1+1);if(s2<=s1+1)return undefined;
 const verText=line.slice(s2+1);if(verText!=='HTTP/1.0'&&verText!=='HTTP/1.1')return undefined;
 const method=line.slice(0,s1),target=line.slice(s1+1,s2),version=verText==='HTTP/1.0'?'1.0':'1.1';
 const headers:Record<string,string>={},lengths:string[]=[];
 let pos=lineEnd+2;
 while(pos<end){
  const nl=buf.indexOf('\r\n',pos);if(nl<0||nl>end)return undefined;
  let colon=-1;
  for(let i=pos;i<nl;i++){const c=buf[i]!;if(c===13||c===10)return undefined;if(c===58&&colon<0)colon=i;}
  if(colon<=pos)return undefined;
  let ks=pos,ke=colon;while(ks<ke&&TRIM_BYTES.has(buf[ks]!))ks++;while(ke>ks&&TRIM_BYTES.has(buf[ke-1]!))ke--;
  if(ks>=ke)return undefined;
  for(let i=ks;i<ke;i++)if(buf[i]!>=128)return undefined;
  const key=buf.toString('latin1',ks,ke).toLowerCase();
  let vs=colon+1,ve=nl;while(vs<ve&&TRIM_BYTES.has(buf[vs]!))vs++;while(ve>vs&&TRIM_BYTES.has(buf[ve-1]!))ve--;
  const value=buf.toString('latin1',vs,ve);
  if(key==='content-length')lengths.push(value);
  if(headers[key]!==undefined&&key!=='content-length')headers[key]+=', '+value;else headers[key]=value;
  pos=nl+2;
 }
 if(headers['transfer-encoding']!==undefined)return undefined;
 if(lengths.length>1||lengths.some(x=>!/^\d+$/.test(x)))return undefined;
 const n=lengths.length?Number(lengths[0]):0;
 if(!Number.isSafeInteger(n)||n>MAX_BODY)return undefined;
 if(buf.length<end+4+n)return undefined;
 const consumed=end+4+n,body=buf.subarray(end+4,consumed);
 const conn=(headers.connection||'').toLowerCase().split(',').map(x=>x.trim());
 const close=conn.includes('close')||(version==='1.0'&&!conn.includes('keep-alive'));
 return {request:{method,target,version,headers,body,consumed,close},headersComplete:true};
}
export function tryParseRequest(buf:Buffer):ParseResult{return tryParseFast(buf)??parseRequestSlow(buf);}
function parseRequestSlow(buf:Buffer):ParseResult{
 const end=buf.indexOf('\r\n\r\n');if(end<0)return {request:null,headersComplete:false};
 const lines=buf.toString('latin1',0,end).split('\r\n'),first=/^([^ ]+) ([^ ]+) HTTP\/(1\.[01])$/.exec(lines.shift()||'');if(!first)return {request:null,error:'bad',headersComplete:true};
 const headers:Record<string,string>={},lengths:string[]=[];for(const line of lines){const i=line.indexOf(':');if(i<=0||/[\r\n]/.test(line))return {request:null,error:'bad',headersComplete:true};const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();if(!key)return {request:null,error:'bad',headersComplete:true};if(key==='content-length')lengths.push(value);if(headers[key]!==undefined&&key!=='content-length')headers[key]+=', '+value;else headers[key]=value;}
 if(lengths.length>1||lengths.some(x=>!/^\d+$/.test(x)))return {request:null,error:'bad',headersComplete:true};
 const te=(headers['transfer-encoding']||'').toLowerCase().split(',').map(x=>x.trim());if(headers['transfer-encoding']!==undefined&&(te.some(x=>x!=='chunked')||te.filter(x=>x==='chunked').length>1))return {request:null,error:'bad',headersComplete:true};if(te.includes('chunked')&&lengths.length)return {request:null,error:'bad',headersComplete:true};let body:Buffer,consumed:number;
 if(te.includes('chunked')){let p=end+4;const chunks:Buffer[]=[];let total=0;for(;;){const nl=buf.indexOf('\r\n',p);if(nl<0)return {request:null,headersComplete:true};const sizeText=buf.toString('ascii',p,nl).split(';',1)[0]!.trim();if(!/^[0-9a-fA-F]+$/.test(sizeText))return {request:null,error:'bad',headersComplete:true};const size=parseInt(sizeText,16);p=nl+2;if(size>MAX_BODY||total+size>MAX_BODY)return {request:null,error:'too-large',headersComplete:true};if(size===0){const trailerEnd=buf.indexOf('\r\n\r\n',p);if(buf.subarray(p,p+2).toString()==='\r\n'){consumed=p+2;break;}if(trailerEnd<0)return {request:null,headersComplete:true};consumed=trailerEnd+4;break;}if(buf.length<p+size+2)return {request:null,headersComplete:true};if(buf[p+size]!==13||buf[p+size+1]!==10)return {request:null,error:'bad',headersComplete:true};chunks.push(buf.subarray(p,p+size));total+=size;p+=size+2;}body=Buffer.concat(chunks);
 }else{const n=lengths.length?Number(lengths[0]):0;if(!Number.isSafeInteger(n))return {request:null,error:'bad',headersComplete:true};if(n>MAX_BODY)return {request:null,error:'too-large',headersComplete:true};if(buf.length<end+4+n)return {request:null,headersComplete:true};consumed=end+4+n;body=buf.subarray(end+4,consumed);}
 const conn=(headers.connection||'').toLowerCase().split(',').map(x=>x.trim());const close=conn.includes('close')||(first[3]==='1.0'&&!conn.includes('keep-alive'));
 return {request:{method:first[1]!,target:first[2]!,version:first[3]!,headers,body,consumed,close},headersComplete:true};
}
function wire(reply:DispatchReply,close:boolean):Buffer{const body=Buffer.isBuffer(reply.body)?reply.body:Buffer.from(reply.body);const second=Math.floor(Date.now()/1000);if(cachedDate?.second!==second)cachedDate={second,text:new Date(second*1000).toUTCString()};const head=[`HTTP/1.1 ${reply.status} ${statusText(reply.status)}\r\n`,...Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}\r\n`),`Date: ${cachedDate.text}\r\n`,`Connection: ${close?'close':'keep-alive'}\r\n`,'\r\n'].join('');return Buffer.concat([Buffer.from(head,'latin1'),body]);}
export function statusText(status:number):string{return ({200:'OK',201:'Created',202:'Accepted',204:'No Content',400:'Bad Request',401:'Unauthorized',404:'Not Found',405:'Method Not Allowed',409:'Conflict',413:'Payload Too Large',422:'Unprocessable Entity'} as Record<number,string>)[status]||'OK';}
function requestError(target:string,status:number):DispatchReply{const h=target.startsWith('/api/v3')?{'X-GitHub-Request-Id':`req-${++requestCounter}`,'X-OAuth-Scopes':'repo'}:{};return json(status,status===413?{message:'request body too large'}:{message:'Bad Request'},h);}
export function createForgeServer():Server{const server=createServer(socket=>serveSocket(socket));return server;}
function serveSocket(socket:Socket){socket.setNoDelay(true);let buffered=Buffer.alloc(0),closed=false,headerTimer:ReturnType<typeof setTimeout>|undefined,idleTimer:ReturnType<typeof setTimeout>|undefined;const clear=()=>{if(headerTimer)clearTimeout(headerTimer);if(idleTimer)clearTimeout(idleTimer);};const fail=(target:string,status:number)=>{if(closed)return;closed=true;clear();try{socket.write(wire(requestError(target,status),true));}catch{}socket.end();};const idle=()=>{if(idleTimer)clearTimeout(idleTimer);idleTimer=setTimeout(()=>socket.destroy(),75000);};idle();socket.on('data',(chunk:Buffer)=>{if(closed)return;if(idleTimer){clearTimeout(idleTimer);idleTimer=undefined;}buffered=buffered.length?Buffer.concat([buffered,chunk]):chunk;let progressed=false;for(;;){const parsed=tryParseRequest(buffered);if(parsed.headersComplete&&headerTimer){clearTimeout(headerTimer);headerTimer=undefined;}if(!parsed.headersComplete&&!parsed.error&&buffered.length&&headerTimer===undefined)headerTimer=setTimeout(()=>fail('',400),80000);if(parsed.error){fail(requestTargetOf(buffered),parsed.error==='too-large'?413:400);return;}if(!parsed.request)break;progressed=true;const req=parsed.request;buffered=buffered.subarray(req.consumed);let reply:DispatchReply;try{reply=dispatch(req.method,req.target,req.headers,req.body);}catch{fail(req.target,400);return;}const isClose=req.close;try{socket.write(wire(reply,isClose));}catch{closed=true;clear();socket.destroy();return;}if(isClose){closed=true;clear();socket.end();return;}idle();}if(progressed&&buffered.length===0){if(idleTimer)clearTimeout(idleTimer);idle();}});socket.on('error',()=>{closed=true;clear();socket.destroy();});socket.on('close',()=>{closed=true;clear();});}
/** Starter-compatible alias. */
export function createApp():Server{return createForgeServer();}
