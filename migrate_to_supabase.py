#!/usr/bin/env python3
"""Migra state.json e assets/uploads da cópia V4.6 para o Supabase."""
import os, json, mimetypes, hashlib, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
URL=os.environ["SUPABASE_URL"].rstrip("/")
KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET="qnt-uploads"
def request(path,data=None,method="GET",content_type="application/json",extra=None):
    headers={"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":content_type};headers.update(extra or {})
    req=urllib.request.Request(URL+path,data=data,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as r:return r.read()
state=json.loads((ROOT/"data"/"state.json").read_text(encoding="utf-8"))
replacements={}
folder=ROOT/"assets"/"uploads"
for file in folder.iterdir():
    if not file.is_file() or file.suffix.lower() not in (".png",".jpg",".jpeg",".webp",".gif"):continue
    raw=file.read_bytes();mime=mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    name=hashlib.sha256(raw).hexdigest()[:24]+file.suffix.lower()
    request("/storage/v1/object/"+BUCKET+"/"+name,raw,"POST",mime,{"x-upsert":"true"})
    replacements["/assets/uploads/"+file.name]=URL+"/storage/v1/object/public/"+BUCKET+"/"+name
    print("Imagem migrada:",file.name)
def walk(obj):
    if isinstance(obj,dict):
        for k,v in list(obj.items()):obj[k]=walk(v)
        return obj
    if isinstance(obj,list):return [walk(v) for v in obj]
    if isinstance(obj,str):return replacements.get(obj,obj)
    return obj
state=walk(state)
payload=json.dumps({"id":1,"state":state},ensure_ascii=False).encode("utf-8")
request("/rest/v1/qnt_state?on_conflict=id",payload,"POST",extra={"Prefer":"resolution=merge-duplicates,return=minimal"})
print("Migração concluída. Imagens enviadas:",len(replacements))
