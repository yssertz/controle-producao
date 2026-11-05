-- Remove registros duplicados de etapas com setores legados que só diferem por caixa (GEKA/Geka).
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
