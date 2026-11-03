-- =====================================================================
-- 0005: VIEWS DE CONSULTA E FUNÇÃO DO DASHBOARD
--
-- As views usam "security_invoker": respeitam o RLS de quem consulta.
-- (Requer PostgreSQL 15+, que é o padrão dos projetos Supabase atuais.)
--
-- COMO O SALDO DE UM ITEM É CALCULADO (sem contar a mesma peça duas vezes):
--   Programado em nestings = soma, por nesting, de:
--        Programado / Em produção -> quantidade programada
--        Concluído                -> quantidade realmente cortada
--        Cancelado                -> 0
--   Cortado                = soma das quantidades cortadas dos nestings Em produção e Concluídos
--   Pendente de corte      = necessário - cortado            (nunca negativo)
--   Pendente de programar  = necessário - programado         (nunca negativo)
--   Excedente              = quanto passou do necessário (só existe com autorização explícita)
-- =====================================================================

create or replace view public.production_item_balance
with (security_invoker = true) as
select
  o.id,
  o.list_id,
  l.name  as list_name,
  l.list_type,
  o.production_line_id,
  pl.name as line_name,
  o.op_number,
  o.item_code,
  o.description,
  o.unit,
  o.equipment_name,
  o.material,
  o.thickness_mm,
  o.due_date,
  o.status,
  o.notes,
  o.archived_at,
  o.created_at,
  o.updated_at,
  o.quantity                                         as qty_total,
  coalesce(a.qty_programmed, 0)                      as qty_programmed,
  coalesce(a.qty_cut, 0)                             as qty_cut,
  greatest(o.quantity - coalesce(a.qty_programmed, 0), 0) as qty_unscheduled,
  greatest(o.quantity - coalesce(a.qty_cut, 0), 0)        as qty_pending_cut,
  greatest(coalesce(a.qty_programmed, 0) - o.quantity, 0) as qty_excess_programmed,
  greatest(coalesce(a.qty_cut, 0) - o.quantity, 0)        as qty_excess_cut
from public.production_orders o
left join public.production_lists l  on l.id = o.list_id
left join public.production_lines pl on pl.id = o.production_line_id
left join lateral (
  select
    sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end) as qty_programmed,
    sum(case when n.status in ('Em produção', 'Concluído') then i.quantity_cut else 0 end) as qty_cut
  from public.nesting_order_items i
  join public.nestings n on n.id = i.nesting_id
  where i.production_order_id = o.id
    and n.status in ('Programado', 'Em produção', 'Concluído')
) a on true;

create or replace view public.nesting_summary
with (security_invoker = true) as
select
  n.id,
  n.code,
  n.list_id,
  l.name       as list_name,
  l.list_type,
  n.laser_machine_id,
  m.name       as machine_name,
  n.material,
  n.thickness_mm,
  n.status,
  n.programmed_at,
  n.notes,
  n.created_at,
  n.started_at,
  n.completed_at,
  coalesce(s.items_count, 0)::integer as items_count,
  coalesce(s.qty_programmed, 0)       as qty_programmed,
  coalesce(s.qty_cut, 0)              as qty_cut
from public.nestings n
left join public.production_lists l on l.id = n.list_id
left join public.laser_machines m   on m.id = n.laser_machine_id
left join lateral (
  select count(*) as items_count,
         sum(i.quantity_programmed) as qty_programmed,
         sum(i.quantity_cut) as qty_cut
  from public.nesting_order_items i
  where i.nesting_id = n.id
) s on true;

create or replace view public.production_list_summary
with (security_invoker = true) as
select
  l.id,
  l.name,
  l.list_type,
  l.reference_date,
  l.status,
  l.notes,
  l.created_at,
  l.updated_at,
  (select count(*) from public.production_orders o where o.list_id = l.id and o.archived_at is null)::integer as items_count,
  (select coalesce(sum(o.quantity), 0) from public.production_orders o where o.list_id = l.id and o.archived_at is null) as qty_total,
  (select count(*) from public.nestings n where n.list_id = l.id and n.status <> 'Cancelado')::integer as nestings_count
from public.production_lists l;

-- ---------------------------------------------------------------------
-- DASHBOARD
-- Filtros (todos opcionais):
--   período (p_from / p_to)  -> itens e listas: data de criação; nestings: data de criação
--                               (os "Concluídos no período" usam a data de conclusão)
--   p_list_id                -> lista
--   p_line_id                -> linha: filtra itens e os nestings que contêm itens dessa linha
--   p_item_status            -> status do ITEM (afeta só os indicadores de itens)
--   p_nesting_status         -> status do NESTING (afeta só os indicadores de nestings)
--   p_machine_id             -> máquina laser (afeta só os indicadores de nestings)
-- Datas são interpretadas no fuso America/Sao_Paulo.
-- security invoker: o RLS do usuário continua valendo.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_summary(
  p_from date default null,
  p_to date default null,
  p_list_id uuid default null,
  p_line_id uuid default null,
  p_item_status text default null,
  p_nesting_status text default null,
  p_machine_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_lists integer;
  v_items jsonb;
  v_nest jsonb;
  v_by_line jsonb;
  v_by_machine jsonb;
begin
  -- Listas (não arquivadas)
  select count(*) into v_lists
    from public.production_lists l
   where l.status <> 'Arquivada'
     and (p_list_id is null or l.id = p_list_id)
     and (p_from is null or (l.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
     and (p_to   is null or (l.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
     and (p_line_id is null or exists (
            select 1 from public.production_orders o
             where o.list_id = l.id and o.production_line_id = p_line_id and o.archived_at is null));

  -- Itens (não arquivados)
  select jsonb_build_object(
    'total',         count(*),
    'open',          count(*) filter (where o.status <> 'Concluída'),
    'waiting',       count(*) filter (where o.status = 'Aguardando'),
    'in_production', count(*) filter (where o.status = 'Em produção'),
    'partial',       count(*) filter (where o.status = 'Parcial'),
    'done',          count(*) filter (where o.status = 'Concluída'),
    'blocked',       count(*) filter (where o.status = 'Bloqueada'),
    'ops_open',      count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status <> 'Concluída'),
    'ops_waiting',   count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status = 'Aguardando')
  ) into v_items
  from public.production_orders o
  where o.archived_at is null
    and (p_list_id is null or o.list_id = p_list_id)
    and (p_line_id is null or o.production_line_id = p_line_id)
    and (p_item_status is null or o.status = p_item_status)
    and (p_from is null or (o.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
    and (p_to   is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to);

  -- Nestings
  with ns as (
    select n.*
      from public.nestings n
     where (p_list_id is null or n.list_id = p_list_id)
       and (p_machine_id is null or n.laser_machine_id = p_machine_id)
       and (p_line_id is null or exists (
              select 1 from public.nesting_order_items i
                join public.production_orders o on o.id = i.production_order_id
               where i.nesting_id = n.id and o.production_line_id = p_line_id))
  ),
  per as (
    select * from ns
     where (p_nesting_status is null or status = p_nesting_status)
       and (p_from is null or (created_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to   is null or (created_at at time zone 'America/Sao_Paulo')::date <= p_to)
  ),
  done as (
    select * from ns
     where status = 'Concluído'
       and (p_nesting_status is null or p_nesting_status = 'Concluído')
       and (p_from is null or (completed_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to   is null or (completed_at at time zone 'America/Sao_Paulo')::date <= p_to)
  ),
  pieces as (
    select
      coalesce(sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end)
               filter (where n.status in ('Programado', 'Em produção', 'Concluído')), 0) as programmed,
      coalesce(sum(i.quantity_cut) filter (where n.status in ('Em produção', 'Concluído')), 0) as cut
    from per n
    join public.nesting_order_items i on i.nesting_id = n.id
    join public.production_orders o on o.id = i.production_order_id
    where p_line_id is null or o.production_line_id = p_line_id
  )
  select jsonb_build_object(
    'programmed',        (select count(*) from per where status = 'Programado'),
    'in_production',     (select count(*) from per where status = 'Em produção'),
    'done_period',       (select count(*) from done),
    'cancelled',         (select count(*) from per where status = 'Cancelado'),
    'pieces_programmed', (select programmed from pieces),
    'pieces_cut',        (select cut from pieces)
  ) into v_nest;

  -- Itens por linha
  select coalesce(jsonb_agg(jsonb_build_object('line', pl.name, 'total', x.total, 'done', x.done)
                            order by pl.sort_order), '[]'::jsonb)
    into v_by_line
    from public.production_lines pl
    join lateral (
      select count(*) as total, count(*) filter (where o.status = 'Concluída') as done
        from public.production_orders o
       where o.production_line_id = pl.id and o.archived_at is null
         and (p_list_id is null or o.list_id = p_list_id)
         and (p_item_status is null or o.status = p_item_status)
         and (p_from is null or (o.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
         and (p_to   is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
    ) x on true
   where x.total > 0
     and (p_line_id is null or pl.id = p_line_id);

  -- Nestings por máquina
  select coalesce(jsonb_agg(jsonb_build_object(
           'machine', m.name,
           'programmed', y.programmed, 'in_production', y.in_production, 'done', y.done,
           'pieces_programmed', y.pieces_programmed, 'pieces_cut', y.pieces_cut)
           order by m.sort_order), '[]'::jsonb)
    into v_by_machine
    from public.laser_machines m
    join lateral (
      select
        count(*) filter (where n.status = 'Programado') as programmed,
        count(*) filter (where n.status = 'Em produção') as in_production,
        count(*) filter (where n.status = 'Concluído') as done,
        coalesce(sum(s.prog), 0) as pieces_programmed,
        coalesce(sum(s.cut), 0) as pieces_cut
      from public.nestings n
      left join lateral (
        select
          sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end) as prog,
          sum(case when n.status in ('Em produção', 'Concluído') then i.quantity_cut else 0 end) as cut
        from public.nesting_order_items i
        join public.production_orders o on o.id = i.production_order_id
        where i.nesting_id = n.id
          and (p_line_id is null or o.production_line_id = p_line_id)
      ) s on n.status <> 'Cancelado'
      where n.laser_machine_id = m.id
        and (p_list_id is null or n.list_id = p_list_id)
        and (p_nesting_status is null or n.status = p_nesting_status)
        and (p_from is null or (n.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
        and (p_to   is null or (n.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
        and (p_line_id is null or exists (
               select 1 from public.nesting_order_items i2
                 join public.production_orders o2 on o2.id = i2.production_order_id
                where i2.nesting_id = n.id and o2.production_line_id = p_line_id))
    ) y on true
   where (p_machine_id is null or m.id = p_machine_id);

  return jsonb_build_object(
    'lists_total', v_lists,
    'items', v_items,
    'nestings', v_nest,
    'items_by_line', v_by_line,
    'nestings_by_machine', v_by_machine
  );
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES: somente usuários logados
-- ---------------------------------------------------------------------
revoke all on public.production_item_balance from anon;
revoke all on public.nesting_summary from anon;
revoke all on public.production_list_summary from anon;
grant select on public.production_item_balance to authenticated;
grant select on public.nesting_summary to authenticated;
grant select on public.production_list_summary to authenticated;

revoke all on function public.dashboard_summary(date, date, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.dashboard_summary(date, date, uuid, uuid, text, text, uuid) to authenticated;
