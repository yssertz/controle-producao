-- Separa linhas compostas em etapas de processo, mantendo a OP como item-base.
-- As quantidades por etapa são armazenadas em production_order_steps para futura baixa independente.
insert into public.production_sectors (name, is_external, active, sort_order)
values ('Laser', false, true, 10), ('Dobra', false, true, 30), ('Usinagem', false, true, 80),
       ('Geka', false, true, 15), ('Guilhotina', false, true, 20), ('Serra', false, true, 40)
on conflict (name) do nothing;

create table if not exists public.production_line_processes (
  production_line_id uuid not null references public.production_lines(id) on delete cascade,
  sector_id uuid not null references public.production_sectors(id) on delete restrict,
  step_order integer not null check (step_order > 0),
  primary key (production_line_id, sector_id),
  unique (production_line_id, step_order)
);

alter table public.production_line_processes enable row level security;
drop policy if exists production_line_processes_read on public.production_line_processes;
create policy production_line_processes_read on public.production_line_processes
  for select to authenticated using (public.cgp_can_read());

-- Cada linha do ERP composta é expandida em processos em ordem operacional.
with process_tokens(token, sector_name, step_order) as (
  values ('LASER', 'Laser', 10), ('GUILHOTINA', 'Guilhotina', 10),
         ('SERRA', 'Serra', 10), ('GEKA', 'Geka', 10),
         ('USINAGEM', 'Usinagem', 20), ('DOBRA', 'Dobra', 30)
)
insert into public.production_line_processes (production_line_id, sector_id, step_order)
select pl.id, ps.id,
       row_number() over (partition by pl.id order by pt.step_order)::integer
  from public.production_lines pl
  cross join process_tokens pt
  join public.production_sectors ps on lower(ps.name) = lower(pt.sector_name)
 where upper(pl.name) like '%' || pt.token || '%'
on conflict (production_line_id, sector_id) do nothing;

-- Linhas sem composição continuam sendo um processo único.
insert into public.production_line_processes (production_line_id, sector_id, step_order)
select pl.id, ps.id, 1
  from public.production_lines pl
  join public.production_sectors ps on lower(ps.name) = lower(pl.name)
 where not exists (select 1 from public.production_line_processes m where m.production_line_id = pl.id)
on conflict do nothing;

-- Backfill das OPs atuais. Não sobrescreve apontamentos já existentes.
insert into public.production_order_steps (production_order_id, sector_id, step_order)
select o.id, m.sector_id, m.step_order
  from public.production_orders o
  join public.production_line_processes m on m.production_line_id = o.production_line_id
 where o.archived_at is null
on conflict (production_order_id, step_order) do nothing;

create or replace function public.cgp_seed_order_process_steps()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.production_order_steps (production_order_id, sector_id, step_order)
  select new.id, m.sector_id, m.step_order
    from public.production_line_processes m
   where m.production_line_id = new.production_line_id
  on conflict (production_order_id, step_order) do nothing;
  return new;
end $$;

drop trigger if exists production_order_seed_process_steps on public.production_orders;
create trigger production_order_seed_process_steps
  after insert or update of production_line_id on public.production_orders
  for each row execute function public.cgp_seed_order_process_steps();

create or replace view public.production_process_progress
with (security_invoker = true) as
select l.id as list_id, l.code as list_code, l.name as list_name,
       s.id as sector_id, s.name as process_name, s.sort_order,
       count(distinct o.id)::integer as items,
       coalesce(sum(o.quantity), 0) as qty_total,
       coalesce(sum(least(steps.quantity_completed, o.quantity)), 0) as qty_done,
       case when sum(o.quantity) > 0
         then round(100.0 * sum(least(steps.quantity_completed, o.quantity)) / sum(o.quantity), 1)
         else 0 end as percent_done
  from public.production_order_steps steps
  join public.production_orders o on o.id = steps.production_order_id and o.archived_at is null
  join public.production_lists l on l.id = o.list_id and l.status <> 'Arquivada'
  join public.production_sectors s on s.id = steps.sector_id
 group by l.id, l.code, l.name, s.id, s.name, s.sort_order;

grant select on public.production_process_progress to authenticated;
revoke all on public.production_line_processes from anon;
revoke all on public.production_process_progress from anon;
