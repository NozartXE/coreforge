import { USERS, type ScenarioUser } from './scenario.ts';
import type { GitObjectData } from './gitobj.ts';
export interface IssueRecord { databaseId:number; nodeId:string; number:number; title:string; body:string; state:'open'|'closed'; labels:string[]; assignees:string[]; author:string; createdAt:string; updatedAt:string; closedAt:string|null }
export interface PullRecord { databaseId:number; nodeId:string; number:number; title:string; body:string; state:'open'|'closed'; headRef:string; baseRef:string; merged:boolean; mergeCommitSha:string|null; author:string; createdAt:string; updatedAt:string; closedAt:string|null; mergedAt:string|null }
export interface LabelRecord { databaseId:number; nodeId:string; name:string; color:string; description:string; createdAt:string }
export interface CommentRecord { databaseId:number; nodeId:string; body:string; author:string; createdAt:string; updatedAt:string; number:number }
export interface RepoRecord { databaseId:number; nodeId:string; ownerLogin:string; name:string; description:string; isPrivate:boolean; defaultBranch:'main'; createdAt:string; updatedAt:string; objects:Map<string,GitObjectData>; refs:Map<string,string>; headRef:'refs/heads/main'; issues:Map<number,IssueRecord>; pulls:Map<number,PullRecord>; labels:Map<string,LabelRecord>; comments:Map<number,CommentRecord[]>; nextNumber:number }
export function globalId(type:string,databaseId:number):string{return Buffer.from(`${type}:${databaseId}`).toString('base64url');}
export function parseGlobalId(id:string):{type:string;databaseId:number}|null{try{const s=Buffer.from(id,'base64url').toString();const i=s.lastIndexOf(':');if(i<1||!/^\d+$/.test(s.slice(i+1)))return null;return{type:s.slice(0,i),databaseId:Number(s.slice(i+1))};}catch{return null;}}
export class Store {
 users=new Map<string,ScenarioUser>(USERS.map(u=>[u.login,u])); repos=new Map<string,RepoRecord>(); private entityId=100000; private clock=0;
 nextId():number{return this.entityId++;}
 tick():string{return new Date(Date.UTC(2026,0,1)+this.clock++*1000).toISOString();}
 repo(owner:string,name:string):RepoRecord|undefined{return this.repos.get(`${owner}/${name}`);}
 createRepo(ownerLogin:string,name:string,description=''):RepoRecord{const databaseId=this.nextId(),now=this.tick();const r:RepoRecord={databaseId,nodeId:globalId('Repository',databaseId),ownerLogin,name,description,isPrivate:false,defaultBranch:'main',createdAt:now,updatedAt:now,objects:new Map(),refs:new Map(),headRef:'refs/heads/main',issues:new Map(),pulls:new Map(),labels:new Map(),comments:new Map(),nextNumber:1};this.repos.set(`${ownerLogin}/${name}`,r);return r;}
}
export const store = new Store();
