const crypto = require("node:crypto");
const JSZip = require("jszip");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_PASSWORD = process.env.QNT_ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.QNT_SESSION_SECRET || "";
const BUCKET = "qnt-uploads";
const STATE_TABLE = "/rest/v1/qnt_state";
const ROOT = process.cwd();
const INITIAL_STATE = require("../data/state.json");

function send(res, status, body, type="application/json; charset=utf-8", headers={}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k,v] of Object.entries(headers)) res.setHeader(k,v);
  res.end(buf);
}
function fail(res,status,message){ return send(res,status,{error:message}); }
function ready(){ return !!(SUPABASE_URL && SERVICE_KEY && ADMIN_PASSWORD && SESSION_SECRET); }
function sign(value){ return crypto.createHmac("sha256",SESSION_SECRET).update(value).digest("base64url"); }
function newToken(){ const exp=String(Date.now()+7*24*60*60*1000); return exp+"."+sign(exp); }
function isAuthorized(req){
  const cookie=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("qnt_session="));
  if(!cookie || !SESSION_SECRET) return false;
  const token=cookie.slice("qnt_session=".length), [exp,mac]=token.split(".");
  if(!exp || !mac || Number(exp)<Date.now()) return false;
  const expected=sign(exp), a=Buffer.from(mac), b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
async function bodyBuffer(req,limit=12*1024*1024){
  const chunks=[]; let total=0;
  for await(const chunk of req){ total+=chunk.length; if(total>limit) throw new Error("Arquivo ou requisição excede o limite permitido."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function bodyJson(req){ const b=await bodyBuffer(req,2*1024*1024); return JSON.parse(b.toString("utf8")||"{}"); }
async function sb(pathname,options={}){
  const response=await fetch(SUPABASE_URL+pathname,{...options,headers:{apikey:SERVICE_KEY,Authorization:"Bearer "+SERVICE_KEY,...(options.headers||{})}});
  const raw=Buffer.from(await response.arrayBuffer());
  if(!response.ok) throw new Error(`Supabase ${response.status}: ${raw.toString("utf8").slice(0,350)}`);
  if(!raw.length)return null;
  try{return JSON.parse(raw.toString("utf8"));}catch{return raw;}
}
async function initialState(){ return JSON.parse(JSON.stringify(INITIAL_STATE)); }
async function getState(){
  const rows=await sb(STATE_TABLE+"?id=eq.1&select=state");
  if(rows && rows[0] && rows[0].state) return rows[0].state;
  return await initialState();
}
async function putState(state){
  await sb(STATE_TABLE+"?on_conflict=id",{method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:1,state,updated_at:new Date().toISOString()})});
  return state;
}
const MAP_POOL=["Lotus","Summit","Sunset","Bind","Corrode","Abyss","Haven"];
const VETO_STEPS={md1:[["pick","a"],["side","b"]],md1_bans:[["ban","a"],["ban","b"],["ban","a"],["ban","b"],["ban","a"],["ban","b"],["side","b"]],final:[["ban","a"],["ban","b"],["pick","a"],["side","b"],["pick","b"],["side","a"],["ban","a"],["ban","b"]]};
function freshVeto(mode="md1"){return {mode,history:[],visible:true};}
function vetoView(v){
  const mode=v.mode||"md1", steps=VETO_STEPS[mode]||VETO_STEPS.md1, history=v.history||[];
  const banned=history.filter(h=>h.action==="ban").map(h=>h.map), picks=history.filter(h=>h.action==="pick").map(h=>h.map);
  const available=MAP_POOL.filter(m=>!banned.includes(m)&&!picks.includes(m)), selected=[];
  for(const h of history){if(h.action==="pick")selected.push({map:h.map,team:h.team,side:null,sideTeam:null});else if(h.action==="side"&&selected.length){selected[selected.length-1].side=h.side;selected[selected.length-1].sideTeam=h.team;}}
  const done=history.length>=steps.length;
  if(mode==="final"&&done&&available.length===1)selected.push({map:available[0],team:null,side:null,sideTeam:null,decider:true});
  if(mode==="md1_bans"&&available.length===1&&history.length>=6)selected.splice(0,selected.length,{map:available[0],team:"a",side:(history.find(h=>h.action==="side")||{}).side||null,sideTeam:"b"});
  return {mode,history,steps,next:done?null:{action:steps[history.length][0],team:steps[history.length][1]},done,banned,available,selected,pool:MAP_POOL};
}
function vetoCommand(state,data){
  const action=data.action; let v=state.veto||(state.veto=freshVeto());
  if(action==="start"){if(!VETO_STEPS[data.mode])throw new Error("Formato de veto inválido");state.veto=freshVeto(data.mode);state.veto.visible=v.visible!==false;if(data.mode==="final")state.event.format="MD3";}
  else if(action==="reset"){state.veto=freshVeto(v.mode||"md1");state.veto.visible=v.visible!==false;}
  else if(action==="undo"){if(v.history&&v.history.length)v.history.pop();}
  else if(action==="visible"){v.visible=!!data.value;}
  else if(action==="decide"){
    const view=vetoView(v),step=view.next;if(!step)throw new Error("O veto já foi concluído");const [kind,team]=[step.action,step.team];
    if(kind==="ban"||kind==="pick"){if(!view.available.includes(data.map))throw new Error("Mapa inválido ou já utilizado");v.history.push({action:kind,team,map:data.map});}
    else {if(!["Atacante","Defensor"].includes(data.side))throw new Error("Escolha Atacante ou Defensor");v.history.push({action:"side",team,side:data.side});}
  } else if(action==="applyMap"){
    const selected=vetoView(v).selected;if(!Number.isInteger(data.index)||data.index<0||data.index>=selected.length)throw new Error("Mapa ainda não definido");
    state.event.map=selected[data.index].map.toUpperCase();state.event.mapNumber=data.index+1;state.event.format=v.mode==="final"?"MD3":"MD1";
  } else throw new Error("Comando de veto inválido");
  state.revision=Number(state.revision||1)+1;return state;
}
function mimeExt(type){return ({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"})[type];}
async function uploadBytes(bytes,type){
  const ext=mimeExt(type);if(!ext)throw new Error("Use imagem PNG, JPG, WebP ou GIF.");
  if(bytes.length>8*1024*1024)throw new Error("Limite de 8 MB por logo.");
  const ok=type==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==="image/jpeg"?bytes[0]===255&&bytes[1]===216:type==="image/webp"?bytes.toString("ascii",8,12)==="WEBP":bytes.toString("ascii",0,6)==="GIF87a"||bytes.toString("ascii",0,6)==="GIF89a";
  if(!ok)throw new Error("Formato da imagem inválido.");
  const name=crypto.createHash("sha256").update(bytes).digest("hex").slice(0,24)+"."+ext;
  await sb(`/storage/v1/object/${BUCKET}/${name}`,{method:"POST",headers:{"Content-Type":type,"x-upsert":"true"},body:bytes});
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;
}
async function signedUpload(bucket,objectPath){
  const encoded=objectPath.split("/").map(encodeURIComponent).join("/");
  const data=await sb(`/storage/v1/object/upload/sign/${bucket}/${encoded}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
  return {uploadUrl:SUPABASE_URL+data.url,token:new URL(data.url,SUPABASE_URL).searchParams.get("token")};
}
function walkReplace(value,fn){
  if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=walkReplace(value[i],fn);return value;}
  if(value&&typeof value==="object"){for(const k of Object.keys(value))value[k]=walkReplace(value[k],fn);return value;}
  if(typeof value==="string")return fn(value);
  return value;
}
function imageRefs(state){const refs=new Set();walkReplace(structuredClone(state),s=>{if(typeof s==="string"&&(s.startsWith("/assets/uploads/")||s.includes("/storage/v1/object/public/")))refs.add(s);return s;});return [...refs];}
async function backup(req,res){
  const state=await getState(),zip=new JSZip();zip.file("state.json",JSON.stringify(state,null,2));
  for(const ref of imageRefs(state)){
    const host=req.headers["x-forwarded-host"]||req.headers.host;
    const url=ref.startsWith("/")?new URL(ref,`https://${host}`).toString():ref;
    try{const r=await fetch(url);if(!r.ok)continue;const b=Buffer.from(await r.arrayBuffer());zip.file("uploads/"+url.split("/").pop().split("?")[0],b);}catch{}
  }
  const data=await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
  const name=`backups/qnt-cup-${Date.now()}.zip`;
  await sb(`/storage/v1/object/qnt-backups/${name}`,{method:"POST",headers:{"Content-Type":"application/zip","x-upsert":"false"},body:data});
  const signed=await sb(`/storage/v1/object/sign/qnt-backups/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expiresIn:180,download:"QNT_CUP_BACKUP.zip"})});
  const location=SUPABASE_URL+signed.signedURL;
  res.statusCode=302;res.setHeader("Location",location);res.setHeader("Cache-Control","no-store");res.end();
}
async function restoreFromStorage(objectPath){
  if(typeof objectPath!=="string"||!/^backups\/[A-Za-z0-9-]+\.zip$/.test(objectPath))throw new Error("Caminho de backup inválido.");
  const encoded=objectPath.split("/").map(encodeURIComponent).join("/");
  const data=await sb(`/storage/v1/object/authenticated/qnt-backups/${encoded}`);
  const zip=await JSZip.loadAsync(data);
  if(!zip.file("state.json"))throw new Error("Backup sem state.json.");
  const state=JSON.parse(await zip.file("state.json").async("string"));
  if(!state||typeof state!=="object"||!state.event||!state.teams)throw new Error("Estado inválido no backup.");
  const replacements={};
  for(const name of Object.keys(zip.files)){
    if(!name.startsWith("uploads/")||zip.files[name].dir)continue;
    const filename=name.split("/").pop();
    if(!/^[a-f0-9]{24}\.(png|jpg|jpeg|webp|gif)$/i.test(filename))throw new Error("Arquivo inesperado no backup.");
    const bytes=await zip.file(name).async("nodebuffer");if(bytes.length>8*1024*1024)throw new Error("Imagem muito grande no backup.");
    const ext=filename.split(".").pop().toLowerCase(),type=({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"})[ext];
    replacements[filename]=await uploadBytes(bytes,type);
  }
  walkReplace(state,s=>{for(const [filename,url] of Object.entries(replacements)){if(s===`/assets/uploads/${filename}`||s.endsWith("/"+filename))return url;}return s;});
  const current=await getState();state.revision=Number(current.revision||1)+1;await putState(state);return {ok:true};
}

async function handler(req,res){
  if(!ready())return fail(res,503,"Configure as variáveis do Supabase e as senhas na Vercel.");
  const pathname=new URL(req.url,"https://qnt.local").pathname;
  const route=pathname.replace(/^\/api\/?/,"");
  try{
    if(route==="health"&&req.method==="GET")return send(res,200,{status:"ok",time:Date.now()});
    if(route==="session"&&req.method==="GET")return send(res,200,{authenticated:isAuthorized(req)});
    if(route==="login"&&req.method==="POST"){
      const body=await bodyJson(req),provided=Buffer.from(String(body.password||"")),expected=Buffer.from(ADMIN_PASSWORD);
      if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected))return fail(res,401,"Senha incorreta.");
      return send(res,200,{ok:true},"application/json; charset=utf-8",{"Set-Cookie":`qnt_session=${newToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`});
    }
    if(route==="logout"&&req.method==="POST")return send(res,200,{ok:true},"application/json; charset=utf-8",{"Set-Cookie":"qnt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"});
    if(route==="state"&&req.method==="GET")return send(res,200,await getState());
    if(route==="veto/view"&&req.method==="GET"){const state=await getState();return send(res,200,vetoView(state.veto||freshVeto()));}
    if(route==="state"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const incoming=await bodyJson(req);if(!incoming||typeof incoming!=="object"||!incoming.event||!incoming.teams)return fail(res,400,"Estado inválido.");
      const old=await getState();incoming.revision=Number(old.revision||1)+1;await putState(incoming);return send(res,200,incoming);
    }
    if(route==="veto"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const data=await bodyJson(req),state=await getState();vetoCommand(state,data);await putState(state);return send(res,200,state);
    }
    if(route==="trigger"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const data=await bodyJson(req),action=data.action;
      if(!["intro","mvp","hideIntro","hideMvp"].includes(action))return fail(res,400,"Ação inválida.");
      const state=await getState();
      if(!state.graphics||typeof state.graphics!=="object")state.graphics={mvpName:"JOGADOR",mvpTeam:"",mvpPrize:"",introUntil:0,mvpUntil:0};
      const isIntro=action==="intro"||action==="hideIntro";
      const key=isIntro?"introUntil":"mvpUntil";
      const duration=isIntro?8500:10000;
      state.graphics[key]=action.startsWith("hide")?0:Date.now()+duration;
      state.revision=Number(state.revision||0)+1;
      await putState(state);
      return send(res,200,{revision:state.revision,graphics:state.graphics,ok:true});
    }
    if(route==="upload/sign"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const body=await bodyJson(req),type=String(body.type||""),ext=mimeExt(type);
      if(!ext)return fail(res,400,"Use imagem PNG, JPG, WebP ou GIF.");
      const objectPath=`${crypto.randomUUID()}.${ext}`,signed=await signedUpload(BUCKET,objectPath);
      return send(res,200,{uploadUrl:signed.uploadUrl,publicUrl:`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`});
    }
    if(route==="upload"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const body=await bodyJson(req),match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(body.data||"");
      if(!match)return fail(res,400,"Use imagem PNG, JPG, WebP ou GIF.");
      const url=await uploadBytes(Buffer.from(match[2],"base64"),match[1]);return send(res,200,{url});
    }
    if(route==="restore/sign"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Acesso administrativo: entre novamente.");
      const objectPath=`backups/restore-${crypto.randomUUID()}.zip`,signed=await signedUpload("qnt-backups",objectPath);
      return send(res,200,{path:objectPath,uploadUrl:signed.uploadUrl});
    }
    if(route==="backup"&&req.method==="GET"){
      if(!isAuthorized(req))return fail(res,401,"Entre para baixar o backup.");return await backup(req,res);
    }
    if(route==="restore"&&req.method==="POST"){
      if(!isAuthorized(req))return fail(res,401,"Entre para restaurar backup.");const body=await bodyJson(req);return send(res,200,await restoreFromStorage(body.path));
    }
    return fail(res,404,"Rota não encontrada.");
  }catch(error){console.error("QNT API:",error);return fail(res,500,error.message||"Erro interno.");}
}
module.exports=handler;
module.exports.config={api:{bodyParser:false}};
