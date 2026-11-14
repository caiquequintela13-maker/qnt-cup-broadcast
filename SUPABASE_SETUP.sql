-- QNT CUP BROADCAST V4.6 — executar no SQL Editor do Supabase
create table if not exists public.qnt_state (
  id integer primary key check (id = 1),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.qnt_state enable row level security;
-- Sem policies públicas. A API da Vercel acessa com service_role somente no servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qnt-uploads','qnt-uploads',true,8388608,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=8388608,
allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('qnt-backups','qnt-backups',false,52428800,array['application/zip'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['application/zip'];
