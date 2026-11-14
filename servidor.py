#!/usr/bin/env python3
"""QNT CUP Broadcast Control — servidor local, apenas biblioteca padrão Python.
Sem contas, nuvem ou dependências de terceiros. Escuta somente 127.0.0.1.
"""
from __future__ import annotations
import base64, binascii, copy, hashlib, io, json, mimetypes, os, re, sys, threading, time, webbrowser, zipfile
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
ASSETS = ROOT / 'assets'
UPLOADS = ASSETS / 'uploads'
STATE_FILE = DATA / 'state.json'
HOST, PORT = '127.0.0.1', 8765
LOCK = threading.RLock()
MAX_REQ = 12 * 1024 * 1024

SPONSORS = [
    dict(id='master1', tier='master', name='Namografic', logo=''),
    dict(id='master2', tier='master', name='Monteiros Pet', logo=''),
    dict(id='oficial1', tier='oficial', name='D.Alves 3D', logo=''),
    dict(id='oficial2', tier='oficial', name='Trajano Sports', logo=''),
    dict(id='oficial3', tier='oficial', name='Kori Gelo', logo=''),
    dict(id='oficial4', tier='oficial', name='Banca Osasco', logo=''),
]

DEFAULT = {
    'revision': 1,
    'event': {'phase': '1ª RODADA', 'format': 'MD1', 'map': 'ASCENT', 'mapNumber': 1, 'matchNumber': 1},
    'teams': {
        'a': {'name': 'EQUIPE A', 'tag': 'A', 'logo': '', 'color': '#25C9D8', 'mapsWon': 0},
        'b': {'name': 'EQUIPE B', 'tag': 'B', 'logo': '', 'color': '#FF4655', 'mapsWon': 0},
    },
    'sponsors': SPONSORS,
    'settings': {'sponsorBug': False, 'showPhase': True, 'showScoreboard': True, 'showRosters': True, 'scoreLayout': 'lateral'},
    'graphics': {
        'introUntil': 0, 'mvpUntil': 0,
        'mvpName': '', 'mvpTeam': '', 'mvpPrize': '400 VP',
    },
    'agents': [],
    'rosters': {'a':[{'nick':'','agent':'','alive':True} for _ in range(5)],'b':[{'nick':'','agent':'','alive':True} for _ in range(5)]},
    'presets': [],
    'veto': {'mode':'md1','history':[],'visible':True}
}


# Sequências oficiais do veto. A = primeiro time do confronto.
MAP_POOL = ('Lotus', 'Summit', 'Sunset', 'Bind', 'Corrode', 'Abyss', 'Haven')
VETO_STEPS = {
    'md1': [('pick','a'), ('side','b')],
    'md1_bans': [('ban','a'), ('ban','b'), ('ban','a'), ('ban','b'), ('ban','a'), ('ban','b'), ('side','b')],
    'final': [('ban','a'), ('ban','b'), ('pick','a'), ('side','b'), ('pick','b'), ('side','a'), ('ban','a'), ('ban','b')],
}
def fresh_veto(mode='md1'):
    return {'mode':mode,'history':[],'visible':True}
def veto_view(veto):
    mode=veto.get('mode','md1')
    steps=VETO_STEPS.get(mode,VETO_STEPS['md1'])
    history=veto.get('history',[])
    banned=[h['map'] for h in history if h['action']=='ban']
    picks=[h['map'] for h in history if h['action']=='pick']
    available=[m for m in MAP_POOL if m not in banned+picks]
    selected=[]
    for h in history:
        if h['action']=='pick': selected.append({'map':h['map'],'team':h['team'],'side':None,'sideTeam':None})
        elif h['action']=='side' and selected:
            selected[-1]['side']=h['side'];selected[-1]['sideTeam']=h['team']
    done=len(history)>=len(steps)
    if mode=='final' and done and len(available)==1:
        selected.append({'map':available[0],'team':None,'side':None,'sideTeam':None,'decider':True})
    if mode=='md1_bans' and len(available)==1 and len(history)>=6:
        selected=[{'map':available[0],'team':'a','side':next((h['side'] for h in history if h['action']=='side'),None),'sideTeam':'b'}]
    return {'mode':mode,'history':history,'steps':steps,'next':None if done else {'action':steps[len(history)][0],'team':steps[len(history)][1]},'done':done,'banned':banned,'available':available,'selected':selected,'pool':list(MAP_POOL)}
def veto_command(state,data):
    action=data.get('action')
    v=state.setdefault('veto',fresh_veto())
    if action=='start':
        mode=data.get('mode')
        if mode not in VETO_STEPS:raise ValueError('Formato de veto inválido')
        state['veto']=fresh_veto(mode)
        state['veto']['visible']=v.get('visible',True)
        if mode=='final':state['event']['format']='MD3'
    elif action=='reset':
        state['veto']=fresh_veto(v.get('mode','md1'))
        state['veto']['visible']=v.get('visible',True)
    elif action=='undo':
        if v['history']:v['history'].pop()
    elif action=='visible':
        v['visible']=bool(data.get('value'))
    elif action=='decide':
        view=veto_view(v)
        step=view['next']
        if not step:raise ValueError('O veto já foi concluído')
        kind,team=step['action'],step['team']
        if kind in ('ban','pick'):
            chosen=data.get('map')
            if chosen not in view['available']:raise ValueError('Mapa inválido ou já utilizado')
            v['history'].append({'action':kind,'team':team,'map':chosen})
        else:
            side=data.get('side')
            if side not in ('Atacante','Defensor'):raise ValueError('Escolha Atacante ou Defensor')
            v['history'].append({'action':'side','team':team,'side':side})
    elif action=='applyMap':
        view=veto_view(v)
        index=data.get('index')
        if not isinstance(index,int) or index<0 or index>=len(view['selected']):raise ValueError('Mapa ainda não definido')
        choice=view['selected'][index]
        state['event']['map']=choice['map'].upper()
        state['event']['mapNumber']=index+1
        state['event']['format']='MD3' if v['mode']=='final' else 'MD1'
    else:raise ValueError('Comando de veto inválido')
    state['revision']=int(state.get('revision',1))+1
    return state

for p in (DATA, UPLOADS): p.mkdir(parents=True, exist_ok=True)

def atomic_write(path: Path, data: bytes):
    tmp = path.with_name(path.name + '.temp')
    tmp.write_bytes(data)
    os.replace(tmp, path)

def save(data):
    atomic_write(STATE_FILE, json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))

def read():
    with LOCK:
        if not STATE_FILE.exists(): save(copy.deepcopy(DEFAULT))
        try:
            d = json.loads(STATE_FILE.read_text(encoding='utf-8'))
            if not isinstance(d, dict): raise ValueError('Invalid format')
            if not isinstance(d.get('veto'),dict):d['veto']=fresh_veto()
            d.setdefault('agents',[])
            d.setdefault('rosters',{'a':[{'nick':'','agent':'','alive':True} for _ in range(5)],'b':[{'nick':'','agent':'','alive':True} for _ in range(5)]})
            d.setdefault('settings',{}).setdefault('showRosters',True)
            return d
        except (OSError, ValueError):
            return copy.deepcopy(DEFAULT)

def validate(new, old):
    """Restringe valores que irão para o template e preserva campos esperados."""
    if not isinstance(new, dict): raise ValueError('Configuração inválida')
    out = copy.deepcopy(old)
    def txt(v, mx=80): return str(v if v is not None else '')[:mx]
    def num(v, lo, hi, fallback):
        try: return min(hi, max(lo, int(v)))
        except (TypeError, ValueError): return fallback
    def logo(v):
        v = txt(v, 240)
        return v if re.fullmatch(r'/assets/(?:uploads/[a-zA-Z0-9_.-]+|qnt_logo\.png|qnt_mark\.png)', v) else ''
    if isinstance(new.get('event'), dict):
        e = new['event']
        out['event'] = dict(
            phase=txt(e.get('phase',old['event']['phase']), 42),
            format=txt(e.get('format','MD1'), 4) if e.get('format') in ['MD1','MD3','MD5'] else 'MD1',
            map=txt(e.get('map',''),40),
            mapNumber=num(e.get('mapNumber'),1,9,1),
            matchNumber=num(e.get('matchNumber'),1,200,1)
        )
    if isinstance(new.get('teams'), dict):
        for side in 'ab':
            t = new['teams'].get(side)
            if not isinstance(t,dict): continue
            color = txt(t.get('color','#FF4655'),7)
            if not re.fullmatch(r'#[0-9a-fA-F]{6}',color): color = old['teams'][side]['color']
            out['teams'][side] = dict(
                name=txt(t.get('name',''),34), tag=txt(t.get('tag',''),9), logo=logo(t.get('logo','')),
                color=color, mapsWon=num(t.get('mapsWon'),0,9,0)
            )
    if isinstance(new.get('agents'),list):
        unique=set();agents=[]
        for a in new['agents'][:80]:
            if not isinstance(a,dict):continue
            name=txt(a.get('name',''),36).strip()
            if not name or name.casefold() in unique:continue
            unique.add(name.casefold())
            agents.append({'name':name,'image':logo(a.get('image',''))})
        out['agents']=agents
    if isinstance(new.get('rosters'),dict):
        out['rosters']={}
        for side in 'ab':
            players=new['rosters'].get(side,[])
            if not isinstance(players,list):players=[]
            out['rosters'][side]=[]
            for i in range(5):
                x=players[i] if i<len(players) and isinstance(players[i],dict) else {}
                out['rosters'][side].append({'nick':txt(x.get('nick',''),30),
                    'agent':txt(x.get('agent',''),36), 'alive':bool(x.get('alive',True))})
    if isinstance(new.get('sponsors'),list):
        new_by_id = {s.get('id'):s for s in new['sponsors'] if isinstance(s,dict)}
        out['sponsors'] = []
        for existing in SPONSORS:
            item = new_by_id.get(existing['id'],{})
            out['sponsors'].append(dict(id=existing['id'], tier=existing['tier'],name=txt(item.get('name', existing['name']),48), logo=logo(item.get('logo',''))))
    if isinstance(new.get('settings'),dict):
        for k in ['sponsorBug','showPhase','showScoreboard','showRosters']:
            out['settings'][k] = bool(new['settings'].get(k, old['settings'].get(k,False)))
        layout=new['settings'].get('scoreLayout',old['settings'].get('scoreLayout','lateral'))
        # Layouts 4.1 antigos ocultavam a interface nativa: migram ao modo lateral seguro.
        out['settings']['scoreLayout'] = layout if layout in ('lateral','estudio') else 'lateral'
    if isinstance(new.get('graphics'),dict):
        g = new['graphics']
        out['graphics']['mvpName'] = txt(g.get('mvpName',''),45)
        out['graphics']['mvpTeam'] = txt(g.get('mvpTeam',''),40)
        out['graphics']['mvpPrize'] = txt(g.get('mvpPrize',''),50)
        # Timers only changed via /api/trigger
    if isinstance(new.get('presets'),list):
        presets = []
        for p in new['presets'][:100]:
            if not isinstance(p,dict) or not isinstance(p.get('teams'),dict) or not isinstance(p.get('event'),dict): continue
            presets.append(dict(id=txt(p.get('id',''),48), name=txt(p.get('name',''),100),
                                teams=p['teams'],event=p['event'],rosters=p.get('rosters')))
        out['presets'] = presets
    out['veto']=copy.deepcopy(old.get('veto',fresh_veto()))
    out['revision'] = int(old.get('revision',1)) + 1
    return out

class Handler(BaseHTTPRequestHandler):
    server_version = 'QNT-CUP-LOCAL/4.6'
    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/state'): super().log_message(fmt,*args)
    def headers_for(self,ctype='application/json; charset=utf-8', length=0):
        self.send_response(200)
        self.send_header('Content-Type',ctype)
        self.send_header('Content-Length',str(length))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:8765')
        self.end_headers()
    def output(self, payload, ctype='application/json; charset=utf-8'):
        if not isinstance(payload,bytes): payload=json.dumps(payload,ensure_ascii=False).encode('utf-8')
        self.headers_for(ctype,len(payload))
        self.wfile.write(payload)
    def fail(self,reason,status=400):
        b=json.dumps({'error':str(reason)},ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def request_bytes(self):
        try: n=int(self.headers.get('Content-Length','0'))
        except ValueError: raise ValueError('Tamanho inválido')
        if n < 1 or n > MAX_REQ: raise ValueError('Arquivo grande demais ou vazio')
        return self.rfile.read(n)
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path=='/api/state': return self.output(read())
        if path=='/api/veto/view': return self.output(veto_view(read().get('veto',fresh_veto())))
        if path=='/api/health': return self.output({'status':'ok','time':int(time.time()*1000)})
        if path=='/api/backup':
            with LOCK:
                mem=io.BytesIO()
                with zipfile.ZipFile(mem,'w',compression=zipfile.ZIP_DEFLATED) as z:
                    z.writestr('state.json',json.dumps(read(),ensure_ascii=False,indent=2))
                    for file in UPLOADS.glob('*'):
                        if file.is_file() and file.suffix.lower() in ('.png','.jpg','.jpeg','.webp','.gif'):
                            z.write(file,'uploads/'+file.name)
                return self.output(mem.getvalue(),'application/zip')
        if path in ('/','/controle'): path='/controle.html'
        if path=='/overlay': path='/overlay.html'
        if path=='/intervalo': path='/intervalo.html'
        if path=='/elencos': path='/elencos.html'
        if path=='/veto': path='/veto.html'
        allowed = {'/controle.html','/overlay.html','/intervalo.html','/veto.html','/assets/veto.css','/assets/veto.js','/elencos.html','/assets/elencos.css','/assets/elencos.js','/assets/qnt_logo.png','/assets/qnt_mark.png','/assets/broadcast.css','/assets/client.js','/assets/controle.css','/assets/controle.js'}
        if path not in allowed and not re.fullmatch(r'/assets/uploads/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)',path,re.IGNORECASE):
            return self.fail('Caminho não encontrado',404)
        dest=(ROOT/path.lstrip('/')).resolve()
        if ROOT not in dest.parents or not dest.is_file(): return self.fail('Arquivo não encontrado',404)
        typ=mimetypes.guess_type(str(dest))[0] or 'application/octet-stream'
        if typ=='text/html': typ+='; charset=utf-8'
        return self.output(dest.read_bytes(),typ)
    def do_POST(self):
        path=urlparse(self.path).path
        try:
            body=self.request_bytes()
            if path=='/api/state':
                new=json.loads(body)
                with LOCK:
                    updated=validate(new,read()); save(updated)
                return self.output(updated)
            if path=='/api/veto':
                data=json.loads(body)
                if not isinstance(data,dict):raise ValueError('Comando inválido')
                with LOCK:
                    updated=veto_command(read(),data);save(updated)
                return self.output(updated)
            if path=='/api/upload':
                data=json.loads(body)
                rawdata=data.get('data','')
                m=re.fullmatch(r'data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)',rawdata)
                if not m: raise ValueError('Use imagem PNG, JPG, WebP ou GIF')
                ext={'jpeg':'jpg'}.get(m[1],m[1]); raw=base64.b64decode(m[2],validate=True)
                if len(raw)>8*1024*1024: raise ValueError('Limite de 8 MB por logo')
                checks={'png':raw.startswith(b'\x89PNG\r\n\x1a\n'),'jpg':raw.startswith(b'\xff\xd8'),'webp':raw[8:12]==b'WEBP','gif':raw[:6] in (b'GIF87a',b'GIF89a')}
                if not checks[ext]: raise ValueError('Formato da imagem inválido')
                digest=hashlib.sha256(raw).hexdigest()[:24]
                filename=digest+'.'+ext
                target=UPLOADS/filename
                if not target.exists(): atomic_write(target,raw)
                return self.output({'url':'/assets/uploads/'+filename})
            if path=='/api/trigger':
                data=json.loads(body)
                action=data.get('action'); duration=8500 if action=='intro' else 10000
                if action not in ('intro','mvp','hideIntro','hideMvp'): raise ValueError('Ação inválida')
                with LOCK:
                    s=read()
                    key='introUntil' if action.lower().endswith('intro') else 'mvpUntil'
                    s['graphics'][key]= int(time.time()*1000)+duration if not action.startswith('hide') else 0
                    s['revision']=int(s.get('revision',1))+1; save(s)
                return self.output(s)
            if path=='/api/restore':
                with zipfile.ZipFile(io.BytesIO(body)) as z:
                    names=z.namelist()
                    if 'state.json' not in names: raise ValueError('Backup sem state.json')
                    raw=json.loads(z.read('state.json'))
                    # Verify all files before restoring. Never trust archive paths.
                    files=[]
                    for n in names:
                        if n=='state.json':continue
                        if not re.fullmatch(r'uploads/[a-f0-9]{24}\.(png|jpg|jpeg|webp|gif)',n):
                            raise ValueError('Arquivo inesperado no backup')
                        payload=z.read(n)
                        if len(payload)>8*1024*1024: raise ValueError('Imagem muito grande no backup')
                        files.append((n,payload))
                    with LOCK:
                        fixed=validate(raw,read())
                        for n,payload in files: atomic_write(UPLOADS/Path(n).name,payload)
                        save(fixed)
                return self.output({'ok':True})
            return self.fail('Rota não encontrada',404)
        except Exception as exc:
            return self.fail(str(exc))

if __name__=='__main__':
    read()
    try:
        httpd=ThreadingHTTPServer((HOST,PORT),Handler)
    except OSError as exc:
        print('Não foi possível abrir o servidor em',PORT,':',exc)
        print('Verifique se já existe uma janela da QNT CUP aberta.'); input('Enter para sair...');sys.exit(1)
    url=f'http://{HOST}:{PORT}/controle'
    print('\n'+'='*56)
    print('  QNT CUP — PAINEL E HUD V4.4')
    print('='*56)
    print(' Painel:   '+url)
    print(' Gameplay: http://127.0.0.1:8765/overlay')
    print(' Intervalo: http://127.0.0.1:8765/intervalo')
    print(' Veto:     http://127.0.0.1:8765/veto')
    print(' MANTENHA ESTA JANELA ABERTA DURANTE A LIVE.')
    print('='*56+'\n')
    threading.Timer(1.1,lambda:webbrowser.open(url)).start()
    try:httpd.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:pass
    finally:httpd.server_close()
