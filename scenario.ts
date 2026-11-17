// Deterministic user and organization fixture, ported from the competition wire generator.
export const SCENARIO_SEED = 0x6a09e667f3bcc909n;
const MASK = 0xffffffffffffffffn;
const FIRST_NAMES = ['ada','bram','cora','dmitri','elena','felix','greta','hugo','iris','jonas','kira','lars','mira','nico','olga','pavel','quinn','rosa','sven','tess','ulla','vito','wren','yara','zane'];
const LAST_NAMES = ['anders','bauer','costa','dahl','eriksen','fischer','garcia','holm','iversen','jansen','keller','lind','moreau','novak','olsen','peters','quist','rossi','sato','turi','ulrich','vega','weber','xu','yilmaz','zimmer'];
const ADJECTIVES = ['amber','brisk','calm','crisp','eager','faint','gentle','happy','idle','jolly','keen','lively','mellow','nimble','open','plain','quick','quiet','rapid','soft','steady','tidy','upbeat','vivid','warm','witty','young','zesty'];
const NOUNS = ['acorn','badger','canyon','cedar','comet','coral','delta','ember','falcon','glade','harbor','indigo','juniper','kettle','lantern','meadow','nebula','orchid','pebble','quartz','raven','saffron','thistle','umber','violet','willow','yarrow','zephyr'];
export function fnv1a64(text: string): bigint { let h=0xcbf29ce484222325n; for(let i=0;i<text.length;i++){h^=BigInt(text.charCodeAt(i));h=(h*0x100000001b3n)&MASK;} return h; }
export function mix64(value: bigint): bigint { let z=(value+0x9e3779b97f4a7c15n)&MASK; z=((z^(z>>30n))*0xbf58476d1ce4e5b9n)&MASK; z=((z^(z>>27n))*0x94d049bb133111ebn)&MASK; return (z^(z>>31n))&MASK; }
function scenarioRng(label:string): { nextInt(n:number):number; pick<T>(a:readonly T[]):T } {
 let state=mix64(SCENARIO_SEED^fnv1a64(label)); if(state===0n)state=SCENARIO_SEED;
 const nextU32=()=>{let x=state;x=(x^(x>>12n))&MASK;x=(x^(x<<25n))&MASK;x=(x^(x>>27n))&MASK;state=x;return Number(((x*0x2545f4914f6cdd1dn)&MASK)>>32n);};
 return { nextInt(n:number){if(n===1)return 0;const range=4294967296,limit=range-range%n;for(;;){const v=nextU32();if(v<limit)return v%n;}}, pick<T>(a:readonly T[]){return a[this.nextInt(a.length)] as T;} };
}
export interface ScenarioUser { login:string; name:string; email:string; id:number }
function generateUsers(rng:ReturnType<typeof scenarioRng>,count:number):ScenarioUser[]{const used=new Set<string>(),users:ScenarioUser[]=[];for(let i=0;i<Math.max(0,Math.trunc(count));i++){const first=rng.pick(FIRST_NAMES),last=rng.pick(LAST_NAMES);const base=`${first}${last}`.replace(/[^a-z0-9-]/g,'');let login=base,suffix=2;while(used.has(login)){login=`${base}-${suffix}`;suffix++;}used.add(login);users.push({id:1000+i,login,name:`${first} ${last}`,email:`${login}@example.invalid`});}return users;}
export const USERS=generateUsers(scenarioRng('users'),12);
export const VIEWER=USERS[0]!;
export const TEAMMATE=USERS[1]!;
export const STRANGER=USERS[2]!;
const orgRng=scenarioRng('org');
export const ORG={login:`${orgRng.pick(ADJECTIVES)}-${orgRng.pick(NOUNS)}-org`,id:2000};

export function buildScenario(){ return { users: USERS, viewer: VIEWER, teammate: TEAMMATE, stranger: STRANGER, org: ORG.login }; }
