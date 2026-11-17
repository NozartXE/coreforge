import type { Store, RepoRecord, PullRecord } from './store.ts';
import { hashObject, parseCommit, mergeBase, mergeTrees, buildCommit, formatPerson, type GitObjectData } from './gitobj.ts';

/** Perform the forge's squash merge and update the pull and base branch in place. */
export function mergePullRequest(store:Store,repo:RepoRecord,pull:PullRecord):boolean {
 if(pull.state!=='open'||pull.merged)return false;
 const base=repo.refs.get(pull.baseRef.startsWith('refs/')?pull.baseRef:`refs/heads/${pull.baseRef}`),head=repo.refs.get(pull.headRef.startsWith('refs/')?pull.headRef:`refs/heads/${pull.headRef}`);
 if(!base||!head)return false;
 const mb=mergeBase(o=>repo.objects.get(o),base,head);if(!mb)return false;
 const scratch=new Map<string,GitObjectData>(),put=(type:string,data:Buffer)=>{const oid=hashObject(type,data);scratch.set(oid,{type:type as GitObjectData['type'],data});return oid;};
 const bc=parseCommit(repo.objects.get(base)!.data),hc=parseCommit(repo.objects.get(head)!.data),res=mergeTrees(o=>scratch.get(o)||repo.objects.get(o),put,parseCommit(repo.objects.get(mb)!.data).tree,bc.tree,hc.tree);
 if(!res.ok)return false;
 for(const [oid,obj] of scratch)repo.objects.set(oid,obj);
 const now=store.tick(),actor=store.users.values().next().value!,person=formatPerson(actor.name,actor.email,now),data=buildCommit({tree:res.tree,parents:[base],author:person,committer:person,message:`${pull.title} (#${pull.number})`}),sha=hashObject('commit',data);
 repo.objects.set(sha,{type:'commit',data});repo.refs.set(`refs/heads/${pull.baseRef.replace(/^refs\/heads\//,'')}`,sha);
 pull.state='closed';pull.merged=true;pull.mergeCommitSha=sha;pull.mergedAt=now;pull.closedAt=now;pull.updatedAt=now;return true;
}
