-- 0001: schema inicial do protótipo (versão original, apenas tornada re-executável).
-- Se você JÁ executou o schema.sql antigo no Supabase, NÃO precisa rodar este arquivo de novo: comece pela 0002.
-- CGP: Controle Geral de Produção. Execute no Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.production_lists(id uuid primary key default gen_random_uuid(),name text not null,list_type text not null check(list_type in('Rodoviário','Ambiental','Pós-vendas','Avulsos','Leniors')),reference_date date,status text not null default 'Planejada' check(status in('Planejada','Em andamento','Concluída','Arquivada')),notes text,created_at timestamptz not null default now());
create table if not exists public.production_orders(id uuid primary key default gen_random_uuid(),list_id uuid references public.production_lists(id) on delete set null,op_number text not null,equipment_name text,item_code text,description text,quantity numeric(14,3) not null default 1 check(quantity>0),material text,thickness_mm numeric(10,3) check(thickness_mm is null or thickness_mm>=0),due_date date,status text not null default 'Aguardando' check(status in('Aguardando','Em produção','Parcial','Concluída','Bloqueada')),created_at timestamptz not null default now());
create index if not exists production_orders_op_idx on public.production_orders(op_number);
create index if not exists production_orders_list_idx on public.production_orders(list_id);
create table if not exists public.nestings(id uuid primary key default gen_random_uuid(),code text not null unique,machine_name text,material text,thickness_mm numeric(10,3) check(thickness_mm is null or thickness_mm>=0),status text not null default 'Programado' check(status in('Programado','Em corte','Cortado','Cancelado')),programmed_at date,notes text,created_at timestamptz not null default now());
create table if not exists public.nesting_order_items(id uuid primary key default gen_random_uuid(),nesting_id uuid not null references public.nestings(id) on delete cascade,production_order_id uuid not null references public.production_orders(id) on delete cascade,quantity_programmed numeric(14,3) not null default 0 check(quantity_programmed>=0),quantity_cut numeric(14,3) not null default 0 check(quantity_cut>=0),created_at timestamptz not null default now(),unique(nesting_id,production_order_id));
create table if not exists public.production_sectors(id uuid primary key default gen_random_uuid(),name text not null unique,is_external boolean not null default false,active boolean not null default true,sort_order integer not null default 0,created_at timestamptz not null default now());
create table if not exists public.production_routes(id uuid primary key default gen_random_uuid(),name text not null,list_type text check(list_type is null or list_type in('Rodoviário','Ambiental','Pós-vendas','Avulsos','Leniors')),equipment_name text,notes text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.production_route_steps(id uuid primary key default gen_random_uuid(),route_id uuid not null references public.production_routes(id) on delete cascade,sector_id uuid not null references public.production_sectors(id),step_order integer not null check(step_order>0),required boolean not null default true,unique(route_id,step_order));
create table if not exists public.production_order_steps(id uuid primary key default gen_random_uuid(),production_order_id uuid not null references public.production_orders(id) on delete cascade,sector_id uuid not null references public.production_sectors(id),step_order integer not null check(step_order>0),status text not null default 'Aguardando' check(status in('Aguardando','Em produção','Parcial','Concluída','Bloqueada','Terceirizado')),quantity_started numeric(14,3) not null default 0 check(quantity_started>=0),quantity_completed numeric(14,3) not null default 0 check(quantity_completed>=0),started_at timestamptz,completed_at timestamptz,notes text,created_at timestamptz not null default now(),unique(production_order_id,step_order));
create table if not exists public.production_logs(id uuid primary key default gen_random_uuid(),order_step_id uuid not null references public.production_order_steps(id) on delete cascade,quantity numeric(14,3) not null default 0 check(quantity>=0),event_type text not null default 'Apontamento',operator_name text,occurred_at timestamptz not null default now(),notes text);
insert into public.production_sectors(name,is_external,sort_order) values('Laser',false,10),('Guilhotina',false,20),('Dobra',false,30),('Solda',false,40),('Pintura',false,50),('Acabamento',false,60),('Montagem',false,70),('Usinagem',false,80),('Expedição',false,90),('Processo externo',true,100) on conflict(name) do nothing;
-- ATENÇÃO: protótipo. Acesso anonimo abaixo serve apenas para teste sem dados reais.
-- Antes de usar na empresa, configure Supabase Auth e policies RLS restritas.
alter table public.production_lists enable row level security;
alter table public.production_orders enable row level security;
alter table public.nestings enable row level security;
alter table public.nesting_order_items enable row level security;
alter table public.production_sectors enable row level security;
alter table public.production_routes enable row level security;
alter table public.production_route_steps enable row level security;
alter table public.production_order_steps enable row level security;
alter table public.production_logs enable row level security;
drop policy if exists "prototype lists anon" on public.production_lists;
create policy "prototype lists anon" on public.production_lists for all to anon using(true) with check(true);
drop policy if exists "prototype orders anon" on public.production_orders;
create policy "prototype orders anon" on public.production_orders for all to anon using(true) with check(true);
drop policy if exists "prototype nestings anon" on public.nestings;
create policy "prototype nestings anon" on public.nestings for all to anon using(true) with check(true);
drop policy if exists "prototype nesting links anon" on public.nesting_order_items;
create policy "prototype nesting links anon" on public.nesting_order_items for all to anon using(true) with check(true);
drop policy if exists "prototype sectors anon" on public.production_sectors;
create policy "prototype sectors anon" on public.production_sectors for all to anon using(true) with check(true);
drop policy if exists "prototype routes anon" on public.production_routes;
create policy "prototype routes anon" on public.production_routes for all to anon using(true) with check(true);
drop policy if exists "prototype route steps anon" on public.production_route_steps;
create policy "prototype route steps anon" on public.production_route_steps for all to anon using(true) with check(true);
drop policy if exists "prototype order steps anon" on public.production_order_steps;
create policy "prototype order steps anon" on public.production_order_steps for all to anon using(true) with check(true);
drop policy if exists "prototype logs anon" on public.production_logs;
create policy "prototype logs anon" on public.production_logs for all to anon using(true) with check(true);
