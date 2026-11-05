-- Production lifecycle: nesting/process completion means fabricated; delivery baja means concluded.
alter table public.production_orders drop constraint if exists production_orders_status_check;
alter table public.production_orders
  add constraint production_orders_status_check
  check (status = any (array['Aguardando','Em produção','Parcial','Fabricada','Concluída','Bloqueada']::text[]));

create or replace function public.cgp_keep_order_status_consistent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.production_deliveries d
     where d.list_id = new.list_id and d.op_number = btrim(new.op_number)
  ) then
    new.status := 'Concluída';
  elsif new.status = 'Concluída' then
    new.status := 'Fabricada';
  end if;
  return new;
end $$;

drop trigger if exists cgp_keep_order_status_consistent on public.production_orders;
create trigger cgp_keep_order_status_consistent
  before insert or update of status, list_id, op_number on public.production_orders
  for each row execute function public.cgp_keep_order_status_consistent();

-- O header de entrega é criado somente após a validação integral da OP pela RPC.
create or replace function public.cgp_mark_order_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.production_orders
     set status = 'Concluída'
   where list_id = new.list_id and btrim(op_number) = new.op_number and archived_at is null;
  return new;
end $$;

drop trigger if exists cgp_mark_order_delivered on public.production_deliveries;
create trigger cgp_mark_order_delivered
  after insert on public.production_deliveries
  for each row execute function public.cgp_mark_order_delivered();

-- Status antigos "Concluída" representavam produção, já que a baixa de entrega ainda não existia.
update public.production_orders o
   set status = 'Fabricada'
 where o.status = 'Concluída'
   and not exists (
     select 1 from public.production_deliveries d
      where d.list_id = o.list_id and d.op_number = btrim(o.op_number)
   );

revoke all on function public.cgp_keep_order_status_consistent() from public, anon, authenticated;
revoke all on function public.cgp_mark_order_delivered() from public, anon, authenticated;

-- Detail by production line and process, with laser fabrication based only on completed nestings.
create or replace view public.production_line_process_progress
with (security_invoker = true) as
with ranked_steps as (
  select st.production_order_id, st.sector_id, st.step_order, st.status, st.quantity_completed,
         o.quantity, l.id as list_id, l.code as list_code, l.name as list_name,
         pl.id as line_id, pl.name as line_name, pl.progress_source,
         s.name as process_name, s.sort_order as process_sort_order,
         row_number() over (
           partition by o.id, lower(btrim(s.name))
           order by st.step_order, s.sort_order, s.name
         ) as process_rank
    from public.production_order_steps st
    join public.production_orders o on o.id = st.production_order_id and o.archived_at is null
    join public.production_lists l on l.id = o.list_id and l.status <> 'Arquivada'
    join public.production_lines pl on pl.id = o.production_line_id
    join public.production_sectors s on s.id = st.sector_id
)
select st.list_id,
       st.list_code,
       st.list_name,
       st.line_id,
       st.line_name,
       st.progress_source,
       st.sector_id,
       st.process_name,
       st.process_sort_order,
       count(*)::integer as items,
       coalesce(sum(st.quantity), 0) as qty_total,
       coalesce(sum(least(st.quantity, greatest(0,
         case
           when st.progress_source = 'nesting' and lower(st.process_name) = 'laser' then coalesce(cut.qty_completed, 0)
           when st.status = 'Não se aplica' then st.quantity
           else coalesce(st.quantity_completed, 0)
         end
       ))), 0) as qty_done,
       coalesce(sum(case when delivered.production_order_id is not null then st.quantity else 0 end), 0) as qty_delivered
  from ranked_steps st
  left join lateral (
    select sum(ni.quantity_cut) as qty_completed
      from public.nesting_order_items ni
      join public.nestings n on n.id = ni.nesting_id and n.status = 'Concluído'
     where ni.production_order_id = st.production_order_id
  ) cut on true
  left join public.production_delivery_items delivered on delivered.production_order_id = st.production_order_id
 where st.process_rank = 1
 group by st.list_id, st.list_code, st.list_name, st.line_id, st.line_name,
          st.progress_source, st.sector_id, st.process_name, st.process_sort_order;

grant select on public.production_line_process_progress to authenticated;
revoke all on public.production_line_process_progress from anon;
