/* QNT CUP Central de Produção: sem framework, sem cloud, alterações via servidor local. */
(() => {
  let state=null, timer=null, saveQueue=Promise.resolve(), lastToast=null;
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const PALETTE=['#25C9D8','#FF4655','#E9B765','#4A8BFF','#8B5CF6','#23B66E','#F2F2F2','#F59E0B','#EC4899','#9097A5'];
  const pages={
    confronto:['Confronto ao vivo','Altere placar, mapa e fase. As mudanças aparecem no OBS.'],
    veto:['Veto de mapas','Gerencie bans, escolhas, lados e mapa decisivo em tempo real.'],
    jogadores:['Jogadores e agentes','Cadastre escalações, associe retratos e controle os eliminados ao vivo.'],
    equipes:['Equipes e logos','Prepare as identidades de cada time e ajuste suas cores.'],
    patrocinadores:['Patrocinadores','Dois masters em destaque e quatro oficiais na tela de intervalo.'],
    graficos:['Banners e MVP','Acione gráficos temporários sem alterar o placar.'],
    salvos:['Confrontos salvos','Guarde partidas para carregar com um clique durante o torneio.'],
    sistema:['Sistema e backup','Controle a visibilidade e preserve os arquivos da produção.']
  };
  function toast(msg,error=false){const e=$('#toast');e.textContent=msg;e.classList.toggle('error',error);e.style.display='block';clearTimeout(lastToast);lastToast=setTimeout(()=>{e.style.display='none'},2800)}
  function status(msg){$('#saveStatus').textContent='● '+msg}
  function tab(name){$$('.navbtn').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));$$('.tab').forEach(x=>x.classList.toggle('visible',x.id==='tab-'+name));$('#pageTitle').textContent=pages[name][0];$('#pageSub').textContent=pages[name][1]}
  function get(path){return path.split('.').reduce((a,k)=>a?.[k],state)}
  function put(path,value){const bits=path.split('.');let ref=state;for(const k of bits.slice(0,-1))ref=ref[k];ref[bits.at(-1)]=value}
  function saveSoon(){if(!state)return;status('Aguardando gravação');clearTimeout(timer);timer=setTimeout(save,450)}
  async function api(route,options={}){const r=await fetch(route,{cache:'no-store',...options});let payload;try{payload=await r.json()}catch{payload={error:'Falha de resposta'}}if(!r.ok)throw Error(payload.error||('Erro HTTP '+r.status));return payload}
  async function save(){
    if(!state)return true;
    if(timer){clearTimeout(timer);timer=null}
    // Cada gravação entra em uma fila: uma requisição antiga nunca pode
    // terminar depois de uma nova e sobrescrever o estado mais recente.
    const snapshot=structuredClone(state);
    status('Salvando...');
    const task=saveQueue.catch(()=>{}).then(()=>api('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)}));
    saveQueue=task.then(()=>undefined,()=>undefined);
    try{
      const out=await task;
      state.revision=Math.max(Number(state.revision||0),Number(out.revision||0));
      status('Salvo automaticamente');
      return true;
    }catch(e){status('Erro ao salvar');toast(e.message,true);return false}
  }
  async function saveNow(){
    if(timer){clearTimeout(timer);timer=null}
    await saveQueue;
    const ok=await save();
    if(!ok)throw Error('Não foi possível salvar os dados antes de acionar o banner. Verifique a conexão e tente novamente.');
  }
  function logoPreview(id,url,fallback){const el=$('#'+id);el.replaceChildren();if(url){const img=document.createElement('img');img.src=url;img.alt='Logo';el.append(img)}else{el.textContent=fallback||'+'}}
  function renderSponsors(){
    const masters=$('#masters'),officials=$('#officials');masters.replaceChildren();officials.replaceChildren();
    state.sponsors.forEach((s,i)=>{
      const card=document.createElement('div');card.className='sponsor-editor '+s.tier;
      const label=document.createElement('div');label.className='s-label';label.textContent=s.tier==='master'?'★ MASTER '+(i+1):'OFICIAL '+(i-1);
      const prev=document.createElement('div');prev.className='sponsor-preview';prev.id='sponsorPrev'+i;
      if(s.logo){const im=document.createElement('img');im.src=s.logo;im.alt='Logo '+s.name;prev.append(im)}else{prev.textContent=s.name||'SEM LOGO'}
      const nameLab=document.createElement('label');nameLab.textContent='Nome do patrocinador';
      const inp=document.createElement('input');inp.maxLength=48;inp.value=s.name;inp.addEventListener('input',()=>{state.sponsors[i].name=inp.value;saveSoon()});nameLab.append(inp);
      const uploadLab=document.createElement('label');uploadLab.className='upload-btn';uploadLab.textContent='↑ ENVIAR LOGO';
      const up=document.createElement('input');up.type='file';up.accept='image/png,image/jpeg,image/webp,image/gif';up.addEventListener('change',async()=>{
        if(up.files.length){await uploadImage(up.files[0],(u)=>state.sponsors[i].logo=u)}up.value='';renderSponsors()
      });uploadLab.append(up);
      const remove=document.createElement('button');remove.className='remove-logo';remove.textContent='Remover logo';remove.onclick=async()=>{state.sponsors[i].logo='';await saveNow();renderSponsors()};
      card.append(label,prev,nameLab,uploadLab,remove);(s.tier==='master'?masters:officials).append(card);
    });
  }
  function renderColors(){
    for(const side of ['a','b']){
      const root=$(`[data-colors="${side}"]`);root.replaceChildren();
      for(const color of PALETTE){const b=document.createElement('button');b.type='button';b.className='color-btn '+(state.teams[side].color.toUpperCase()===color.toUpperCase()?'selected':'');b.style.background=color;b.title=color;b.setAttribute('aria-label','Selecionar cor '+color);b.onclick=()=>{state.teams[side].color=color;renderColors();saveSoon()};root.append(b)}
    }
  }
  function renderPresets(){
    const root=$('#presetList');root.replaceChildren();
    for(const p of state.presets){
      const row=document.createElement('div');row.className='preset';
      const left=document.createElement('div');const title=document.createElement('div');title.className='preset-title';title.textContent=p.name;
      const sub=document.createElement('div');sub.className='preset-caption';sub.textContent=p.event.phase+' • '+p.event.format+' • '+p.event.map;
      left.append(title,sub);
      const controls=document.createElement('div');controls.className='button-row';
      const load=document.createElement('button');load.textContent='Carregar';load.onclick=async()=>{
        // manter logos, nomes e cores da escalação salva; preservar patrocinadores atuais.
        state.teams=structuredClone(p.teams);state.event=structuredClone(p.event);if(p.rosters)state.rosters=structuredClone(p.rosters);await saveNow();render();tab('confronto');toast('Confronto carregado: '+p.name)
      };
      const del=document.createElement('button');del.className='outline';del.textContent='Excluir';del.onclick=async()=>{if(!confirm('Excluir o confronto salvo "'+p.name+'"?'))return;state.presets=state.presets.filter(x=>x.id!==p.id);await saveNow();renderPresets()};
      controls.append(load,del);row.append(left,controls);root.append(row);
    }
  }
  function node(tag,klass,txt){const e=document.createElement(tag);if(klass)e.className=klass;if(txt!==undefined)e.textContent=txt;return e}
  function setSideAlive(side,alive){state.rosters[side].forEach(p=>p.alive=alive);renderRosterEditors();saveSoon()}
  function setAllAlive(alive){for(const side of ['a','b'])state.rosters[side].forEach(p=>p.alive=alive);renderRosterEditors();saveSoon()}
  function renderAgents(){
    const root=$('#agentLibrary');root.replaceChildren();
    if(!state.agents.length)root.append(node('p','','Nenhum agente cadastrado. Adicione o nome e envie um retrato.'));
    state.agents.forEach((agent,i)=>{
      const card=node('div','agent-library-card');const prev=node('div','agent-thumb');
      if(agent.image){const im=node('img');im.src=agent.image;im.alt=agent.name;prev.append(im)}else prev.textContent='?';
      const title=node('strong','',agent.name);
      const upload=node('label','upload-btn','↑ FOTO');const file=node('input');file.type='file';file.accept='image/png,image/jpeg,image/webp,image/gif';
      file.onchange=async()=>{if(!file.files[0])return;await uploadImage(file.files[0],url=>{state.agents[i].image=url});renderAgents();renderRosterEditors()};upload.append(file);
      const remove=node('button','outline small','✕');remove.title='Excluir agente da biblioteca';remove.onclick=()=>{if(!confirm('Excluir '+agent.name+' da biblioteca?'))return;state.agents.splice(i,1);renderAgents();renderRosterEditors();saveSoon()};
      card.append(prev,title,upload,remove);root.append(card);
    });
  }
  function renderRosterEditors(){
    for(const side of ['a','b']){
      $('#rosterTitle'+side.toUpperCase()).textContent=state.teams[side].name+' · 5 JOGADORES';
      const root=$('#rosterEditor'+side.toUpperCase());root.replaceChildren();
      state.rosters[side].forEach((player,i)=>{
        const card=node('div','player-edit'+(player.alive?'':' eliminated'));
        const portrait=node('div','player-portrait');const agent=state.agents.find(x=>x.name===player.agent);
        if(agent?.image){const img=node('img');img.src=agent.image;img.alt=agent.name;portrait.append(img)}else portrait.textContent=(player.agent||'?').slice(0,2).toUpperCase();
        const fields=node('div','player-fields');const nick=node('input');nick.placeholder='Nick do jogador '+(i+1);nick.maxLength=30;nick.value=player.nick;
        nick.oninput=()=>{player.nick=nick.value;saveSoon()};
        const select=node('select');const empty=node('option','','Selecione o agente');empty.value='';select.append(empty);
        if(player.agent&&!state.agents.some(a=>a.name===player.agent)){const o=node('option','',player.agent+' (não cadastrado)');o.value=player.agent;select.append(o)}
        state.agents.forEach(a=>{const o=node('option','',a.name);o.value=a.name;select.append(o)});select.value=player.agent;
        select.onchange=()=>{player.agent=select.value;renderRosterEditors();saveSoon()};fields.append(nick,select);
        const status=node('button',player.alive?'kill-button':'revive-button',player.alive?'☠ ELIMINAR':'↻ REVIVER');
        status.onclick=()=>{player.alive=!player.alive;renderRosterEditors();saveSoon()};
        card.append(portrait,fields,status);root.append(card);
      });
    }
  }
  function render(){
    if(!state)return;
    $$('[data-path]').forEach(el=>{
      const v=get(el.dataset.path);if(el.type==='checkbox')el.checked=Boolean(v);else if(document.activeElement!==el)el.value=v??'';
    });
    $('#scoreTeamA').textContent=state.teams.a.name;$('#scoreTeamB').textContent=state.teams.b.name;
    $('#scoreValueA').textContent=state.teams.a.mapsWon;$('#scoreValueB').textContent=state.teams.b.mapsWon;
    $$('[data-format]').forEach(el=>el.classList.toggle('chosen',el.dataset.format===state.event.format));
    $$('[data-phase]').forEach(el=>el.classList.toggle('chosen',el.dataset.phase===state.event.phase));
    $$('[data-layout]').forEach(el=>el.classList.toggle('chosen',el.dataset.layout===(state.settings.scoreLayout||'lateral')));
    logoPreview('previewLogoA',state.teams.a.logo,state.teams.a.tag);
    logoPreview('previewLogoB',state.teams.b.logo,state.teams.b.tag);
    renderColors();renderSponsors();renderPresets();renderVeto();renderAgents();renderRosterEditors();
  }

  const MAPS=['Lotus','Summit','Sunset','Bind','Corrode','Abyss','Haven'];
  const VETO_STEPS={md1:[['pick','a'],['side','b']],md1_bans:[['ban','a'],['ban','b'],['ban','a'],['ban','b'],['ban','a'],['ban','b'],['side','b']],final:[['ban','a'],['ban','b'],['pick','a'],['side','b'],['pick','b'],['side','a'],['ban','a'],['ban','b']]};
  function viewVeto(){
    const v=state.veto||{mode:'md1',history:[],visible:true};const steps=VETO_STEPS[v.mode]||VETO_STEPS.md1;
    const used=v.history.filter(x=>x.action!=='side').map(x=>x.map);
    const available=MAPS.filter(m=>!used.includes(m));const selected=[];
    v.history.forEach(h=>{if(h.action==='pick')selected.push({map:h.map,side:null});if(h.action==='side'&&selected.length)selected[selected.length-1].side=h.side});
    if(v.mode==='final'&&v.history.length===steps.length&&available.length===1)selected.push({map:available[0],decider:true});
    if(v.mode==='md1_bans'&&v.history.length>=6&&available.length===1)selected.splice(0,selected.length,{map:available[0],side:v.history.find(x=>x.action==='side')?.side||null});
    return {v,steps,available,selected,next:steps[v.history.length]};
  }
  async function vetoAction(action,extra={}){
    try{await saveNow();const updated=await api('/api/veto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});state=updated;render();toast('Veto atualizado')}catch(e){toast(e.message,true)}
  }
  function renderVeto(){
    const {v,steps,available,selected,next}=viewVeto();
    $$('[data-veto-mode]').forEach(b=>b.classList.toggle('chosen',b.dataset.vetoMode===v.mode));
    const team=t=>state.teams[t]?.name||'Equipe '+t.toUpperCase();
    $('#vetoCounter').textContent=v.history.length+' / '+steps.length;
    $('#vetoTurn').textContent=next?(team(next[1])+' · '+({ban:'BANIR MAPA',pick:'ESCOLHER MAPA',side:'ESCOLHER LADO'}[next[0]])):'VETO CONCLUÍDO';
    $('#vetoInstruction').textContent=next?(next[0]==='side'?'Escolha o lado inicial para o mapa selecionado.':'Selecione um dos mapas disponíveis abaixo.'):'Todos os mapas definidos. Use os botões abaixo para aplicar o mapa ao HUD.';
    $('#vetoVisibility').textContent=v.visible?'◉ Cena visível · ocultar':'◯ Cena oculta · exibir';
    $('#vetoUndo').disabled=!v.history.length;
    const grid=$('#vetoChoices');grid.replaceChildren();
    MAPS.forEach(map=>{
      const h=v.history.find(x=>x.map===map),b=document.createElement('button');b.className='veto-map-btn'+(h?' used '+h.action:'');b.disabled=!!h||!next||next[0]==='side';
      const label=document.createElement('strong');label.textContent=map.toUpperCase();const tag=document.createElement('span');tag.textContent=h?(h.action==='ban'?'BANIDO':'ESCOLHIDO'):'DISPONÍVEL';b.append(label,tag);
      b.onclick=()=>vetoAction('decide',{map});grid.append(b);
    });
    const sides=$('#vetoSides');sides.replaceChildren();if(next&&next[0]==='side')for(const side of ['Atacante','Defensor']){const b=document.createElement('button');b.textContent=side.toUpperCase();b.onclick=()=>vetoAction('decide',{side});sides.append(b)}
    const results=$('#vetoResults');results.replaceChildren();if(!selected.length)results.textContent='Os mapas selecionados aparecerão aqui.';
    selected.forEach((item,i)=>{const box=document.createElement('div');box.className='veto-result';const heading=document.createElement('strong');heading.textContent='MAPA '+(i+1)+(item.decider?' · DESEMPATE':'')+' — '+item.map.toUpperCase();const info=document.createElement('span');info.textContent=item.side?'Lado escolhido: '+item.side:'Lado ainda não definido';const btn=document.createElement('button');btn.textContent='USAR COMO MAPA ATUAL';btn.className='outline small';btn.onclick=()=>vetoAction('applyMap',{index:i});box.append(heading,info,btn);results.append(box)});
    const history=$('#vetoHistory');history.replaceChildren();if(!v.history.length)history.textContent='Nenhuma decisão registrada.';
    v.history.forEach((h,i)=>{const line=document.createElement('div');line.className='veto-history-row';line.textContent=String(i+1).padStart(2,'0')+'  '+team(h.team)+' — '+(h.action==='ban'?'BANIU '+h.map:h.action==='pick'?'ESCOLHEU '+h.map:'ESCOLHEU LADO '+h.side);history.append(line)});
  }

  async function uploadImage(file,apply){
    if(file.size>8*1024*1024){toast('Limite: 8 MB por logo',true);return}
    const types=['image/png','image/jpeg','image/webp','image/gif'];
    if(!types.includes(file.type)){toast('Use PNG, JPG ou WebP',true);return}
    status('Enviando logo...');
    try{
      const signed=await api('/api/upload/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:file.type})});
      const uploaded=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
      if(!uploaded.ok)throw Error('O Supabase não conseguiu receber a imagem.');
      apply(signed.publicUrl);await saveNow();toast('Logo aplicada com sucesso')
    }catch(e){status('Falha no envio');toast(e.message,true)}
  }
  async function trigger(action){
    try{
      // Primeiro conclui todas as gravações do painel; só então dispara o gráfico.
      await saveNow();
      const d=await api('/api/trigger',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
      state.revision=Number(d.revision||state.revision||0);
      if(d.graphics)state.graphics=structuredClone(d.graphics);
      toast(({intro:'Apresentação ao vivo',mvp:'MVP ao vivo',hideIntro:'Apresentação ocultada',hideMvp:'MVP ocultado'})[action]);
    }catch(e){toast(e.message,true)}
  }
  function bind(){
    $$('.navbtn').forEach(x=>x.onclick=()=>tab(x.dataset.tab));
    $$('[data-veto-mode]').forEach(b=>b.onclick=()=>{if(state.veto?.history?.length&&!confirm('Trocar o formato reinicia o veto atual. Continuar?'))return;vetoAction('start',{mode:b.dataset.vetoMode})});
    $('#vetoUndo').onclick=()=>vetoAction('undo');
    $('#vetoReset').onclick=()=>{if(confirm('Reiniciar todas as decisões do veto atual?'))vetoAction('reset')};
    $('#vetoVisibility').onclick=()=>vetoAction('visible',{value:!state.veto.visible});
    $$('[data-path]').forEach(el=>{
      el.addEventListener(el.type==='checkbox'?'change':'input',()=>{
        let v=el.type==='checkbox'?el.checked:el.value;
        if(el.type==='number')v=Math.max(1,parseInt(v,10)||1);
        put(el.dataset.path,v);saveSoon();
      });
    });
    $$('[data-score]').forEach(el=>el.onclick=()=>{const [side,delta]=el.dataset.score.split(':');state.teams[side].mapsWon=Math.max(0,Math.min(9,state.teams[side].mapsWon+Number(delta)));render();saveSoon()});
    $('#resetScore').onclick=()=>{state.teams.a.mapsWon=0;state.teams.b.mapsWon=0;render();saveSoon()};
    $$('[data-format]').forEach(el=>el.onclick=()=>{state.event.format=el.dataset.format;render();saveSoon()});
    $$('[data-phase]').forEach(el=>el.onclick=()=>{state.event.phase=el.dataset.phase;render();saveSoon()});
    $$('[data-layout]').forEach(el=>el.onclick=()=>{state.settings.scoreLayout=el.dataset.layout;render();saveSoon()});
    $$('[data-upload^="team-"]').forEach(inp=>inp.addEventListener('change',async()=>{
      const side=inp.dataset.upload.split('-')[1];if(inp.files.length)await uploadImage(inp.files[0],(url)=>state.teams[side].logo=url);inp.value='';render()
    }));
    $$('.remove-logo').forEach(el=>el.onclick=async()=>{const side=el.dataset.remove.split('-')[1];state.teams[side].logo='';render();await saveNow()});
    $('#swapTeams').onclick=async()=>{[state.rosters.a,state.rosters.b]=[state.rosters.b,state.rosters.a];[state.teams.a,state.teams.b]=[state.teams.b,state.teams.a];render();await saveNow()};
    $('#agentAdd').onclick=()=>{const name=$('#agentNewName').value.trim();if(!name)return toast('Digite o nome do agente',true);if(state.agents.some(x=>x.name.toLowerCase()===name.toLowerCase()))return toast('Agente já cadastrado',true);state.agents.push({name,image:''});$('#agentNewName').value='';renderAgents();renderRosterEditors();saveSoon()};
    $('#reviveAll').onclick=()=>setAllAlive(true);$('#killAllA').onclick=()=>setSideAlive('a',false);$('#killAllB').onclick=()=>setSideAlive('b',false);
    $('#resetTeams').onclick=async()=>{state.teams.a.mapsWon=0;state.teams.b.mapsWon=0;render();await saveNow();tab('confronto')};
    $('#showIntro').onclick=()=>trigger('intro');$('#hideIntro').onclick=()=>trigger('hideIntro');
    $('#showMvp').onclick=()=>trigger('mvp');$('#hideMvp').onclick=()=>trigger('hideMvp');
    $('#savePreset').onclick=async()=>{const name=$('#presetName').value.trim()||(state.teams.a.name+' x '+state.teams.b.name);const id='p'+Date.now();
      state.presets.push({id,name,teams:structuredClone(state.teams),event:structuredClone(state.event),rosters:structuredClone(state.rosters)});await saveNow();$('#presetName').value='';renderPresets();toast('Confronto salvo')};
    $('#restoreFile').onchange=async(ev)=>{const file=ev.target.files[0];if(!file)return;
      if(!confirm('Restaurar backup substitui as configurações e confrontos atuais. Continuar?'))return;
      try{
        const signed=await api('/api/restore/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
        const uploaded=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/zip'},body:file});
        if(!uploaded.ok)throw Error('Não foi possível enviar o arquivo de backup ao Supabase.');
        await api('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:signed.path})});
        state=await api('/api/state');render();toast('Backup restaurado')
      }catch(e){toast(e.message,true)}finally{ev.target.value=''}
    };
  }
  async function boot(){
    try{
      const session=await api('/api/session');
      if(!session.authenticated){
        const password=prompt('QNT CUP • Digite a senha administrativa compartilhada:');
        if(password===null){$('#connectionLabel').textContent='Acesso não autorizado';status('Login necessário');return;}
        await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      }
      state=await api('/api/state');$('#signal').classList.add('online');$('#connectionLabel').textContent='Equipe conectada';status('Pronto');bind();render();
      setInterval(async()=>{
        if(timer||busy||!state)return;
        try{const remote=await api('/api/state');if(remote.revision!==state.revision){state=remote;render();status('Sincronizado com a equipe');}}
        catch(e){if(e.message.includes('entre novamente'))status('Sessão expirada; recarregue e entre novamente');}
      },1200);
    }catch(e){$('#connectionLabel').textContent='Falha no acesso';status('Offline');toast('Não foi possível entrar: '+e.message,true)}
  }
  boot();
})();
