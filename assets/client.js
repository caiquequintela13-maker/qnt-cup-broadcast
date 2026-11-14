/* QNT CUP — somente apresentação. O controle é em /controle, nunca nesta tela. */
(() => {
  const isBreak = document.body.classList.contains('interval');
  let state = null, seenRevision = -1;
  const $ = (id) => document.getElementById(id);
  const text = (id,value) => {const el=$(id); if(el)el.textContent=String(value ?? '');};
  const logo = (target,src,tag,large=false) => {
    if(!target)return;
    const key=(src||'')+'#'+(tag||'')+'#'+large;
    if(target.dataset.logoKey===key)return;
    target.dataset.logoKey=key;
    target.replaceChildren();
    if(src){const image=document.createElement('img');image.src=src;image.alt='Logo de '+tag;
      if(large){image.style.maxWidth='112px';image.style.maxHeight='112px'}
      image.onerror=()=>{if(target.contains(image)){image.remove();const span=document.createElement('span');span.className=large?'no-logo':'team-placeholder';span.textContent=(tag||'?').slice(0,2).toUpperCase();target.append(span)}};
      target.appendChild(image);
    }else{const fallback=document.createElement('span');fallback.className=large?'no-logo':'team-placeholder';fallback.textContent=(tag||'?').slice(0,2).toUpperCase();target.append(fallback)}
  };
  function renderSponsors(items,grid){
    if(!grid)return;
    grid.replaceChildren();
    for(const s of items){
      const card=document.createElement('div');card.className='sponsor-card';
      if(s.logo){const im=document.createElement('img');im.src=s.logo;im.alt=s.name||'Patrocinador';card.append(im)}
      else{const n=document.createElement('div');n.className='name';n.textContent=s.name||'A confirmar';card.append(n)}
      const cap=document.createElement('div');cap.className='caption';cap.textContent=s.tier==='master'?'PATROCINADOR MASTER':'PATROCINADOR OFICIAL';card.append(cap);
      grid.append(card);
    }
  }
  function makePlayerRow(player, side, agents){
    const row=document.createElement('div');row.className='official-player '+side+(player.alive?'':' dead');
    const portrait=document.createElement('div');portrait.className='official-face';
    const agent=(agents||[]).find(a=>a.name===player.agent);
    if(agent?.image){const img=document.createElement('img');img.src=agent.image;img.alt=player.agent;portrait.append(img)}
    else portrait.textContent=(player.agent||'?').slice(0,2).toUpperCase();
    const info=document.createElement('div');info.className='official-meta';
    const nick=document.createElement('strong');nick.textContent=player.nick||'JOGADOR';
    const ag=document.createElement('small');ag.textContent=player.agent||'SEM AGENTE';
    info.append(nick,ag);
    const status=document.createElement('div');status.className='official-state';
    status.textContent=player.alive?'VIVO':'ABATIDO';
    row.append(portrait,info,status);
    return row;
  }
  function renderRosterColumn(root, side, stateObj){
    if(!root)return;
    root.replaceChildren();
    if(!stateObj.settings?.showRosters){ root.style.display='none'; return; }
    root.style.display='block';
    const team=stateObj.teams[side];
    const players=(stateObj.rosters?.[side]||[]).slice(0,5);
    const aliveCount=players.filter(p=>p.alive).length;
    const head=document.createElement('div');head.className='roster-head '+side;
    const titleWrap=document.createElement('div');titleWrap.className='roster-team';
    const badge=document.createElement('div');badge.className='roster-badge';
    logo(badge,team.logo,team.tag,false);
    const words=document.createElement('div');words.className='roster-title';
    const title=document.createElement('strong');title.textContent=team.name;
    const meta=document.createElement('small');meta.textContent=aliveCount+' VIVOS';
    words.append(title,meta); titleWrap.append(badge,words);
    const score=document.createElement('div');score.className='roster-series-score';score.textContent=team.mapsWon;
    head.append(titleWrap,score);
    root.append(head);
    players.forEach(p=>root.append(makePlayerRow(p,side,stateObj.agents||[])));
  }
  function renderGame(d){
    document.body.dataset.scoreLayout=d.settings?.scoreLayout||'lateral';
    const a=d.teams.a,b=d.teams.b,e=d.event;
    document.documentElement.style.setProperty('--a',a.color);
    document.documentElement.style.setProperty('--b',b.color);
    const bar=$('top-scorebar'); if(bar) bar.style.display=d.settings.showScoreboard?'flex':'none';
    const phasePill=$('phasePill'); if(phasePill) phasePill.style.display=d.settings.showPhase?'inline-flex':'none';
    text('phasePill',e.phase); text('aName',a.name); text('bName',b.name); text('aTag',a.tag); text('bTag',b.tag);
    text('aScore',a.mapsWon); text('bScore',b.mapsWon); text('centerMap',e.format+' • MAPA '+e.mapNumber+' • '+e.map);
    logo($('aLogo'),a.logo,a.tag); logo($('bLogo'),b.logo,b.tag);
    renderRosterColumn($('roster-left'),'a',d); renderRosterColumn($('roster-right'),'b',d);
    text('introStage',e.phase+' • JOGO '+e.matchNumber);
    text('introA',a.name);text('introB',b.name);text('introMap','MAPA '+e.mapNumber+' • '+e.map);
    logo($('introALogo'),a.logo,a.tag,true);logo($('introBLogo'),b.logo,b.tag,true);
    text('mvpName',d.graphics.mvpName||'JOGADOR');text('mvpSub',d.graphics.mvpTeam||'');text('mvpPrize',d.graphics.mvpPrize||'');
  }
  function renderBreak(d){
    const a=d.teams.a,b=d.teams.b,e=d.event;
    document.documentElement.style.setProperty('--a',a.color);
    document.documentElement.style.setProperty('--b',b.color);
    text('breakPhase',e.phase+' — JOGO '+e.matchNumber);
    text('breakAName',a.name);text('breakBName',b.name);text('breakATag',a.tag);text('breakBTag',b.tag);
    text('breakScore',a.mapsWon+' : '+b.mapsWon);text('breakFormat',e.format);
    text('breakMap','MAPA '+e.mapNumber+' • '+e.map);
    logo($('breakALogo'),a.logo,a.tag,true);logo($('breakBLogo'),b.logo,b.tag,true);
    renderSponsors(d.sponsors.filter(x=>x.tier==='master'),$('masterGrid'));
    renderSponsors(d.sponsors.filter(x=>x.tier==='oficial'),$('officialGrid'));
  }
  function render(d){
    state=d;
    if(isBreak) renderBreak(d); else renderGame(d);
  }
  function tick(){
    if(!state || isBreak)return;
    const now=Date.now(),g=state.graphics;
    $('intro').classList.toggle('show',g.introUntil>now);
    $('mvp').classList.toggle('show',g.mvpUntil>now);
    const bug=$('bug');
    if(!state.settings.sponsorBug){bug.style.display='none';return}
    const sponsors=state.sponsors.filter(x=>x.logo||x.name);
    if(!sponsors.length){bug.style.display='none';return}
    const durations=sponsors.map(s=>s.tier==='master'?28000:14000);
    const total=durations.reduce((x,y)=>x+y,0);
    let pos=now%total,idx=0;
    while(idx<durations.length-1 && pos>=durations[idx]){pos-=durations[idx];idx++}
    const s=sponsors[idx];
    if(bug.dataset.current!==s.id){
      bug.dataset.current=s.id;
      text('bugTier',s.tier==='master'?'★ PATROCINADOR MASTER':'PATROCINADOR OFICIAL');
      const space=$('bugImage');space.replaceChildren();
      if(s.logo){const im=document.createElement('img');im.src=s.logo;im.alt=s.name;space.append(im)}
      else{const txt=document.createElement('div');txt.className='sponsor-name';txt.textContent=s.name;space.append(txt)}
    }
    bug.style.display='block';
  }
  let isPolling=false;
  async function poll(){
    if(isPolling)return;
    isPolling=true;
    try{
      const r=await fetch('/api/state',{cache:'no-store'});
      if(!r.ok)throw Error('Offline');
      const d=await r.json();
      if(d.revision!==seenRevision){render(d);seenRevision=d.revision;tick()}
    }catch(e){ }
    finally{isPolling=false}
  }
  poll();setInterval(poll,550);setInterval(tick,180);
})();
