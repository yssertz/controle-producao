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
  select count(*) into v_lists
    from public.production_lists l
   where l.status <> 'Arquivada'
     and (p_list_id is null or l.id = p_list_id)
     and (p_from is null or (l.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
     and (p_to is null or (l.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
     and (p_line_id is null or exists (
            select 1 from public.production_orders o
             where o.list_id = l.id and o.production_line_id = p_line_id and o.archived_at is null));

  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where o.status <> 'Concluída'),
    'waiting', count(*) filter (where o.status = 'Aguardando'),
    'in_production', count(*) filter (where o.status = 'Em produção'),
    'partial', count(*) filter (where o.status = 'Parcial'),
    'fabricated', count(*) filter (where o.status = 'Fabricada'),
    'done', count(*) filter (where o.status = 'Concluída'),
    'blocked', count(*) filter (where o.status = 'Bloqueada'),
    'ops_open', count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status <> 'Concluída'),
    'ops_waiting', count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status = 'Aguardando')
  ) into v_items
  from public.production_orders o
  where o.archived_at is null
    and (p_list_id is null or o.list_id = p_list_id)
    and (p_line_id is null or o.production_line_id = p_line_id)
    and (p_item_status is null or o.status = p_item_status)
    and (p_from is null or (o.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
    and (p_to is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to);

  with ns as (
    select n.*
      from public.nestings n
     where (p_list_id is null or exists (
              select 1 from public.nesting_order_items il
                join public.production_orders ol on ol.id = il.production_order_id
               where il.nesting_id = n.id and ol.list_id = p_list_id))
       and (p_machine_id is null or n.laser_machine_id = p_machine_id)
       and (p_line_id is null or exists (
              select 1 from public.nesting_order_items i
                join public.production_orders o on o.id = i.production_order_id
               where i.nesting_id = n.id and o.production_line_id = p_line_id))
  ),
  per as (
    select * from ns
     where (p_nesting_status is null or status = p_nesting_status)
       and (p_from is null or ((case when status = 'Concluído' then completed_at else created_at end) at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to is null or ((case when status = 'Concluído' then completed_at else created_at end) at time zone 'America/Sao_Paulo')::date <= p_to)
  ),
  pieces as (
    select
      coalesce(sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end)
               filter (where n.status in ('Programado', 'Em produção', 'Concluído')), 0) as programmed,
      coalesce(sum(i.quantity_cut) filter (where n.status in ('Em produção', 'Concluído')), 0) as cut
    from per n
    join public.nesting_order_items i on i.nesting_id = n.id
    join public.production_orders o on o.id = i.production_order_id
    where (p_line_id is null or o.production_line_id = p_line_id)
      and (p_list_id is null or o.list_id = p_list_id)
  )
  select jsonb_build_object(
    'programmed', (select count(*) from per where status = 'Programado'),
    'in_production', (select count(*) from per where status = 'Em produção'),
    'done_period', (select count(*) from per where status = 'Concluído'),
    'cancelled', (select count(*) from per where status = 'Cancelado'),
    'pieces_programmed', (select programmed from pieces),
    'pieces_cut', (select cut from pieces)
  ) into v_nest;

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
         and (p_to is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
    ) x on true
   where x.total > 0 and (p_line_id is null or pl.id = p_line_id);

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
          and (p_list_id is null or o.list_id = p_list_id)
      ) s on n.status <> 'Cancelado'
      where n.laser_machine_id = m.id
        and (p_list_id is null or exists (
               select 1 from public.nesting_order_items il
                 join public.production_orders ol on ol.id = il.production_order_id
                where il.nesting_id = n.id and ol.list_id = p_list_id))
        and (p_nesting_status is null or n.status = p_nesting_status)
        and (p_from is null or ((case when n.status = 'Concluído' then n.completed_at else n.created_at end at time zone 'America/Sao_Paulo')::date >= p_from))
        and (p_to is null or ((case when n.status = 'Concluído' then n.completed_at else n.created_at end at time zone 'America/Sao_Paulo')::date <= p_to))
        and (p_line_id is null or exists (
               select 1 from public.nesting_order_items i2
                 join public.production_orders o2 on o2.id = i2.production_order_id
                where i2.nesting_id = n.id and o2.production_line_id = p_line_id))
    ) y on true
   where p_machine_id is null or m.id = p_machine_id;

  return jsonb_build_object(
    'lists_total', v_lists,
    'items', v_items,
    'nestings', v_nest,
    'items_by_line', v_by_line,
    'nestings_by_machine', v_by_machine
  );
end $$;
