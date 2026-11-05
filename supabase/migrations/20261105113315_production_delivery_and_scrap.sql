create table if not exists public.production_deliveries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.production_lists(id) on delete restrict,
  op_number text not null check (btrim(op_number) <> ''),
  delivered_by uuid not null references auth.users(id),
  delivered_by_name text not null,
  delivered_at timestamptz not null default now(),
  notes text,
  unique (list_id, op_number)
);

create table if not exists public.production_delivery_items (
  delivery_id uuid not null references public.production_deliveries(id) on delete restrict,
  production_order_id uuid not null unique references public.production_orders(id) on delete restrict,
  quantity_delivered numeric(14,3) not null check (quantity_delivered > 0),
  primary key (delivery_id, production_order_id)
);

create table if not exists public.production_scrap_reports (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  sector_id uuid not null references public.production_sectors(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  reason text not null check (btrim(reason) <> ''),
  reported_by uuid not null references auth.users(id),
  reported_by_name text not null,
  reported_at timestamptz not null default now()
);

create index if not exists production_scrap_order_idx
  on public.production_scrap_reports (production_order_id, reported_at desc);

alter table public.production_deliveries enable row level security;
alter table public.production_delivery_items enable row level security;
alter table public.production_scrap_reports enable row level security;

drop policy if exists production_deliveries_read on public.production_deliveries;
create policy production_deliveries_read on public.production_deliveries
  for select to authenticated using (public.cgp_can_read());
drop policy if exists production_delivery_items_read on public.production_delivery_items;
create policy production_delivery_items_read on public.production_delivery_items
  for select to authenticated using (public.cgp_can_read());
drop policy if exists production_scrap_reports_read on public.production_scrap_reports;
create policy production_scrap_reports_read on public.production_scrap_reports
  for select to authenticated using (public.cgp_can_read());

revoke all on public.production_deliveries, public.production_delivery_items, public.production_scrap_reports from anon;
revoke insert, update, delete on public.production_deliveries, public.production_delivery_items, public.production_scrap_reports from authenticated;
grant select on public.production_deliveries, public.production_delivery_items, public.production_scrap_reports to authenticated;

create or replace function public.record_production_delivery(p_list_id uuid, p_op_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_delivery_id uuid;
  v_row record;
  v_ready numeric;
  v_scrap numeric;
  v_operator text;
  v_count integer := 0;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para registrar entregas.' using errcode = '42501';
  end if;
  if p_list_id is null or btrim(coalesce(p_op_number, '')) = '' then
    raise exception 'Informe a lista e o número da OP.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, auth.uid()::text)
    into v_operator from public.user_profiles where id = auth.uid() and active;

  perform 1 from public.production_orders
   where list_id = p_list_id and btrim(op_number) = btrim(p_op_number) and archived_at is null
   order by id for update;
  if not found then raise exception 'Nenhuma peça ativa foi encontrada para esta OP.'; end if;

  if exists (select 1 from public.production_deliveries where list_id = p_list_id and op_number = btrim(p_op_number)) then
    raise exception 'Esta OP já foi entregue.';
  end if;

  for v_row in
    select o.id, o.quantity, o.op_number, pl.progress_source,
           coalesce(c.qty_cut, 0) as qty_cut,
           coalesce(s.qty_ready, 0) as qty_ready,
           coalesce(r.qty_scrap, 0) as qty_scrap
      from public.production_orders o
      left join public.production_lines pl on pl.id = o.production_line_id
      left join lateral (
        select sum(i.quantity_cut) as qty_cut
          from public.nesting_order_items i
          join public.nestings n on n.id = i.nesting_id
         where i.production_order_id = o.id and n.status in ('Em produção', 'Concluído')
      ) c on true
      left join lateral (
        select min(case when st.status = 'Não se aplica' then o.quantity else st.quantity_completed end) as qty_ready
          from public.production_order_steps st where st.production_order_id = o.id
      ) s on true
      left join lateral (
        select sum(sr.quantity) as qty_scrap
          from public.production_scrap_reports sr where sr.production_order_id = o.id
      ) r on true
     where o.list_id = p_list_id and btrim(o.op_number) = btrim(p_op_number) and o.archived_at is null
     order by o.id
  loop
    v_ready := case when v_row.progress_source = 'nesting' then v_row.qty_cut - v_row.qty_scrap else v_row.qty_ready end;
    if v_ready < v_row.quantity then
      raise exception 'A OP % ainda não está pronta para entrega. Item %: disponível %, necessário %.',
        btrim(p_op_number), v_row.id, greatest(v_ready, 0), v_row.quantity;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Nenhuma peça ativa foi encontrada para esta OP.'; end if;

  insert into public.production_deliveries(list_id, op_number, delivered_by, delivered_by_name)
  values (p_list_id, btrim(p_op_number), auth.uid(), coalesce(v_operator, auth.uid()::text))
  returning id into v_delivery_id;

  insert into public.production_delivery_items(delivery_id, production_order_id, quantity_delivered)
  select v_delivery_id, o.id, o.quantity
    from public.production_orders o
   where o.list_id = p_list_id and btrim(o.op_number) = btrim(p_op_number) and o.archived_at is null;

  return v_delivery_id;
end $$;

create or replace function public.record_production_scrap(
  p_production_order_id uuid, p_sector_id uuid, p_quantity numeric, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order public.production_orders;
  v_line_source text;
  v_step_order integer;
  v_step_status text;
  v_available numeric;
  v_report_id uuid;
  v_operator text;
  v_step record;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para registrar refugo.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'A quantidade de refugo deve ser maior que zero.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Informe o motivo do refugo.'; end if;

  select o.* into v_order from public.production_orders o
   where o.id = p_production_order_id and o.archived_at is null for update;
  if not found then raise exception 'Item da OP não encontrado ou arquivado.'; end if;
  if exists (select 1 from public.production_deliveries d
             where d.list_id = v_order.list_id and d.op_number = btrim(v_order.op_number)) then
    raise exception 'Não é possível registrar refugo após a entrega da OP.';
  end if;

  select coalesce(pl.progress_source, 'manual') into v_line_source from public.production_lines pl where pl.id = v_order.production_line_id;
  select st.step_order, st.status into v_step_order, v_step_status
    from public.production_order_steps st
   where st.production_order_id = p_production_order_id and st.sector_id = p_sector_id
   for update;
  if not found then raise exception 'O processo selecionado não pertence a esta OP.'; end if;
  if v_step_status = 'Não se aplica' then raise exception 'Não é possível registrar refugo em um processo marcado como não aplicável.'; end if;

  select coalesce(nullif(btrim(full_name), ''), email, auth.uid()::text)
    into v_operator from public.user_profiles where id = auth.uid() and active;

  if v_line_source <> 'nesting' then
    select coalesce(min(case when st.status = 'Não se aplica' then v_order.quantity else st.quantity_completed end), 0)
      into v_available
      from public.production_order_steps st
     where st.production_order_id = p_production_order_id and st.step_order >= v_step_order;
    if v_available < p_quantity then
      raise exception 'O processo tem apenas % peça(s) disponível(is) para registrar como refugo.', greatest(v_available, 0);
    end if;
  else
    select coalesce(sum(i.quantity_cut), 0) - coalesce((select sum(sr.quantity) from public.production_scrap_reports sr where sr.production_order_id = p_production_order_id), 0)
      into v_available
      from public.nesting_order_items i
      join public.nestings n on n.id = i.nesting_id
     where i.production_order_id = p_production_order_id and n.status in ('Em produção', 'Concluído');
    if v_available < p_quantity then
      raise exception 'O corte tem apenas % peça(s) disponível(is) para registrar como refugo.', greatest(v_available, 0);
    end if;
  end if;

  insert into public.production_scrap_reports(production_order_id, sector_id, quantity, reason, reported_by, reported_by_name)
  values (p_production_order_id, p_sector_id, p_quantity, btrim(p_reason), auth.uid(), coalesce(v_operator, auth.uid()::text))
  returning id into v_report_id;

  if v_line_source <> 'nesting' then
    for v_step in
      select st.id, st.quantity_completed, st.sector_id, ps.name
        from public.production_order_steps st
        join public.production_sectors ps on ps.id = st.sector_id
       where st.production_order_id = p_production_order_id and st.step_order >= v_step_order
       order by st.step_order
       for update of st
    loop
      if v_step.quantity_completed > 0 then
        update public.production_order_steps
           set quantity_completed = greatest(0, quantity_completed - p_quantity),
               status = case
                 when greatest(0, quantity_completed - p_quantity) >= v_order.quantity then 'Concluída'
                 when greatest(0, quantity_completed - p_quantity) > 0 then 'Parcial'
                 else 'Aguardando'
               end,
               completed_at = case when greatest(0, quantity_completed - p_quantity) >= v_order.quantity then now() else null end
         where id = v_step.id;
        insert into public.production_logs(order_step_id, quantity, event_type, operator_name, notes)
        values (v_step.id, least(v_step.quantity_completed, p_quantity), 'Refugo (reposição)', coalesce(v_operator, auth.uid()::text), btrim(p_reason));
      end if;
    end loop;
  end if;

  return v_report_id;
end $$;

create or replace function public.cgp_item_blockers(p_item_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_codes text;
  v_n integer;
  v_inv text;
  v_reasons text[] := '{}';
begin
  select string_agg(distinct n.code, ', ' order by n.code), count(*)
    into v_codes, v_n
    from public.nesting_order_items i
    join public.nestings n on n.id = i.nesting_id
   where i.production_order_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || ('participa dos nestings ' || v_codes); end if;

  if exists (select 1 from public.production_order_steps s
              where s.production_order_id = p_item_id
                and (s.status <> 'Aguardando' or s.quantity_started > 0 or s.quantity_completed > 0))
     or exists (select 1 from public.production_logs l
                  join public.production_order_steps s on s.id = l.order_step_id
                 where s.production_order_id = p_item_id) then
    v_reasons := v_reasons || 'tem etapas ou apontamentos de produção registrados';
  end if;

  if exists (select 1 from public.production_delivery_items d where d.production_order_id = p_item_id) then
    v_reasons := v_reasons || 'tem entrega registrada';
  end if;
  if exists (select 1 from public.production_scrap_reports r where r.production_order_id = p_item_id) then
    v_reasons := v_reasons || 'tem refugo registrado';
  end if;

  select invoice_number into v_inv from public.production_orders where id = p_item_id;
  if v_inv is not null and btrim(v_inv) <> '' then v_reasons := v_reasons || ('tem nota fiscal registrada (' || v_inv || ')'); end if;

  if array_length(v_reasons, 1) is null then return null; end if;
  return array_to_string(v_reasons, '; ');
end $$;

create or replace function public.cgp_guard_delivered_order_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.list_id is distinct from old.list_id
      or new.op_number is distinct from old.op_number
      or new.production_line_id is distinct from old.production_line_id
      or new.quantity is distinct from old.quantity)
     and exists (select 1 from public.production_delivery_items d where d.production_order_id = old.id) then
    raise exception 'Não é possível alterar lista, OP, linha ou quantidade de uma peça já entregue.';
  end if;
  if (new.list_id is distinct from old.list_id
      or new.op_number is distinct from old.op_number
      or new.production_line_id is distinct from old.production_line_id
      or new.quantity is distinct from old.quantity)
     and exists (select 1 from public.production_scrap_reports r where r.production_order_id = old.id) then
    raise exception 'Não é possível alterar lista, OP, linha ou quantidade de uma peça com refugo registrado.';
  end if;
  return new;
end $$;

drop trigger if exists cgp_guard_delivered_order_update on public.production_orders;
create trigger cgp_guard_delivered_order_update
  before update of list_id, op_number, production_line_id, quantity on public.production_orders
  for each row execute function public.cgp_guard_delivered_order_update();

revoke all on function public.record_production_delivery(uuid, text) from public, anon;
revoke all on function public.record_production_scrap(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.cgp_guard_delivered_order_update() from public, anon, authenticated;
grant execute on function public.record_production_delivery(uuid, text) to authenticated;
grant execute on function public.record_production_scrap(uuid, uuid, numeric, text) to authenticated;
