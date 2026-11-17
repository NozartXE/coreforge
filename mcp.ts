import type { Store } from './store.ts';
import { issueObject, pullObject, repoObject } from './rest.ts';
import { mergePullRequest } from './merge.ts';

const VERSIONS=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
const SERVER={name:'coreforge',version:'1.0.0'};
const field=(type:string,description:string)=>({type,description});
export const TOOLS=[
 {name:'create_repo',description:'Create a repository owned by the authenticated user.',inputSchema:{type:'object',properties:{name:field('string','Repository name.'),description:field('string','Repository description.'),private:field('boolean','Whether the repository is private.')},required:['name']}},
 {name:'get_repo',description:'Get a repository by owner and name.',inputSchema:{type:'object',properties:{owner:field('string','Repository owner login.'),repo:field('string','Repository name.')},required:['owner','repo']}},
 {name:'create_issue',description:'Create an issue in a repository.',inputSchema:{type:'object',properties:{owner:field('string','Repository owner login.'),repo:field('string','Repository name.'),title:field('string','Issue title.'),body:field('string','Issue body.')},required:['owner','repo','title']}},
 {name:'list_issues',description:'List repository issues, open by default.',inputSchema:{type:'object',properties:{owner:field('string','Repository owner login.'),repo:field('string','Repository name.'),state:field('string','Issue state: open, closed, or all.')},required:['owner','repo']}},
 {name:'create_pull_request',description:'Open a pull request between repository branches.',inputSchema:{type:'object',properties:{owner:field('string','Repository owner login.'),repo:field('string','Repository name.'),title:field('string','Pull request title.'),head:field('string','Head branch name.'),base:field('string','Base branch name.'),body:field('string','Pull request body.')},required:['owner','repo','title','head','base']}},
 {name:'merge_pull_request',description:'Squash merge an open pull request.',inputSchema:{type:'object',properties:{owner:field('string','Repository owner login.'),repo:field('string','Repository name.'),pull_number:field('integer','Pull request number.')},required:['owner','repo','pull_number']}}
];
type Reply={status:number;body:string;headers?:Record<string,string>};
const response=(id:unknown,key:'result'|'error',value:unknown,headers?:Record<string,string>):Reply=>({status:200,body:JSON.stringify({jsonrpc:'2.0',id,[key]:value}),...(headers?{headers}:{})});
const rpcError=(id:unknown,code:number,message:string):Reply=>response(id,'error',{code,message});
const toolError=(id:unknown,message:string):Reply=>response(id,'result',{content:[{type:'text',text:message}],isError:true});
function callTool(store:Store,name:string,args:Record<string,any>,host:string,id:unknown):Reply {
 const missing=TOOLS.find(t=>t.name===name)?.inputSchema.required.find(k=>args[k]===undefined);
 if(missing)return rpcError(id,-32602,`Missing required argument: ${missing}`);
 const viewer=store.users.keys().next().value as string;
 if(name==='create_repo'){
  const n=args.name;if(typeof n!=='string'||!n||n.length>100||!/^[A-Za-z0-9._-]+$/.test(n)||n==='.'||n==='..')return toolError(id,'Validation Failed');
  if(store.repo(viewer,n))return toolError(id,'Validation Failed');
  const repo=store.createRepo(viewer,n,args.description===undefined?'':String(args.description));repo.isPrivate=!!args.private;
  return success(repoObject(store,repo,host));
 }
 const repo=store.repo(String(args.owner),String(args.repo));if(!repo)return toolError(id,'Not Found');
 if(name==='get_repo')return success(repoObject(store,repo,host));
 if(name==='create_issue'){
  if(typeof args.title!=='string'||!args.title.trim())return toolError(id,'Validation Failed');
  const number=repo.nextNumber++,databaseId=store.nextId(),now=store.tick(),issue={databaseId,nodeId:Buffer.from(`Issue:${databaseId}`).toString('base64url'),number,title:args.title,body:String(args.body??''),state:'open' as const,labels:[],assignees:[],author:viewer,createdAt:now,updatedAt:now,closedAt:null};
  repo.issues.set(number,issue);return success(issueObject(store,repo,issue,host));
 }
 if(name==='list_issues'){
  const state=args.state===undefined?'open':String(args.state);if(!['open','closed','all'].includes(state))return toolError(id,'Validation Failed');
  return success([...repo.issues.values()].filter(x=>state==='all'||x.state===state).sort((a,b)=>b.number-a.number).map(x=>issueObject(store,repo,x,host)));
 }
 if(name==='create_pull_request'){
  if(typeof args.title!=='string'||!args.title.trim())return toolError(id,'Validation Failed');
  const head=String(args.head).replace(/^.*?:/,'').replace(/^refs\/heads\//,''),base=String(args.base).replace(/^refs\/heads\//,'');
  const hasRef=(ref:string)=>repo.refs.has(ref.startsWith('refs/')?ref:`refs/heads/${ref}`);
  if(!hasRef(head)||!hasRef(base))return toolError(id,'Validation Failed');
  if([...repo.pulls.values()].some(p=>p.state==='open'&&p.headRef===head&&p.baseRef===base))return toolError(id,'Validation Failed');
  const number=repo.nextNumber++,databaseId=store.nextId(),now=store.tick(),pull={databaseId,nodeId:Buffer.from(`PullRequest:${databaseId}`).toString('base64url'),number,title:args.title,body:String(args.body??''),state:'open' as const,headRef:head,baseRef:base,merged:false,mergeCommitSha:null,author:viewer,createdAt:now,updatedAt:now,closedAt:null,mergedAt:null};
  repo.pulls.set(number,pull);return success(pullObject(store,repo,pull,host));
 }
 if(name==='merge_pull_request'){
  const pull=repo.pulls.get(Number(args.pull_number));if(!pull)return toolError(id,'Not Found');
  if(!mergePullRequest(store,repo,pull))return toolError(id,'Pull Request is not mergeable');
  return success(pullObject(store,repo,pull,host));
 }
 return rpcError(id,-32602,`Unknown tool: ${name}`);
 function success(payload:unknown):Reply{return response(id,'result',{content:[{type:'text',text:JSON.stringify(payload)}],structuredContent:payload,isError:false});}
}
export function handleMCP(store:Store,rawBody:Buffer,host:string):Reply {
 let request:any;try{request=JSON.parse(rawBody.toString('utf8'));}catch{return {status:400,body:JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})};}
 const id=request&&typeof request==='object'&&Object.hasOwn(request,'id')?request.id:null,method=request?.method;
 if(typeof method==='string'&&method.startsWith('notifications/')&&!Object.hasOwn(request,'id'))return {status:202,body:''};
 if(method==='server/discover')return response(id,'result',{resultType:'complete',supportedVersions:VERSIONS,capabilities:{tools:{}},serverInfo:SERVER,_meta:{'io.modelcontextprotocol/serverInfo':SERVER}});
 if(method==='initialize'){const version=request?.params?.protocolVersion;return response(id,'result',{protocolVersion:VERSIONS.includes(version)?version:'2025-06-18',capabilities:{tools:{}},serverInfo:SERVER},{'Mcp-Session-Id':'coreforge-session'});}
 if(method==='ping')return response(id,'result',{});
 if(method==='tools/list')return response(id,'result',{tools:TOOLS});
 if(method==='tools/call'){
  const name=String(request?.params?.name??''),tool=TOOLS.find(t=>t.name===name);if(!tool)return rpcError(id,-32602,`Unknown tool: ${name}`);
  const args=request?.params?.arguments&&typeof request.params.arguments==='object'&&!Array.isArray(request.params.arguments)?request.params.arguments:{};
  return callTool(store,name,args,host,id);
 }
 return rpcError(id,-32601,'Method not found');
}
