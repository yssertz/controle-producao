create or replace function public.cgp_refresh_order_production_status(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_quantity numeric;
  v_status text;
  v_source text;
  v_target text;
  v_made numeric;
  v_steps integer;
  v_all_done boolean;
  v_any_done boolean;
begin
  select o.quantity, o.status, coalesce(pl.progress_source, 'manual')
    into v_quantity, v_status, v_source
    from public.production_orders o
    left join public.production_lines pl on pl.id = o.production_line_id
   where o.id = p_order_id and o.archived_at is null
   for update of o;
  if not found then return; end if;

  if exists (select 1 from public.production_deliveries d
              join public.production_orders o on o.list_id = d.list_id and btrim(o.op_number) = d.op_number
             where o.id = p_order_id) then
    v_target := 'Concluída';
  elsif v_status = 'Bloqueada' then
    return;
  elsif v_source = 'nesting' then
    select greatest(0,
             coalesce((select sum(i.quantity_cut)
                         from public.nesting_order_items i
                         join public.nestings n on n.id = i.nesting_id and n.status = 'Concluído'
                        where i.production_order_id = p_order_id), 0)
             - coalesce((select sum(r.quantity) from public.production_scrap_reports r where r.production_order_id = p_order_id), 0))
      into v_made;
    v_target := case when v_made >= v_quantity then 'Fabricada'
                     when v_made > 0 then 'Em produção' else 'Aguardando' end;
  else
    select count(*)::integer,
           coalesce(bool_and(s.status = 'Não se aplica' or s.quantity_completed >= v_quantity), false),
           coalesce(bool_or(s.quantity_completed > 0), false)
      into v_steps, v_all_done, v_any_done
      from public.production_order_steps s
     where s.production_order_id = p_order_id;
    v_target := case when v_steps > 0 and v_all_done then 'Fabricada'
                     when v_any_done then 'Em produção' else 'Aguardando' end;
  end if;

  update public.production_orders set status = v_target where id = p_order_id and status is distinct from v_target;
end $$;

create or replace function public.cgp_order_step_status_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.cgp_refresh_order_production_status(old.production_order_id);
    return old;
  end if;
  perform public.cgp_refresh_order_production_status(new.production_order_id);
  return new;
end $$;

drop trigger if exists cgp_order_step_status_changed on public.production_order_steps;
create trigger cgp_order_step_status_changed
  after insert or update of status, quantity_completed or delete on public.production_order_steps
  for each row execute function public.cgp_order_step_status_changed();

create or replace function public.cgp_scrap_status_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.cgp_refresh_order_production_status(new.production_order_id);
  return new;
end $$;

drop trigger if exists cgp_scrap_status_changed on public.production_scrap_reports;
create trigger cgp_scrap_status_changed
  after insert on public.production_scrap_reports
  for each row execute function public.cgp_scrap_status_changed();

revoke all on function public.cgp_refresh_order_production_status(uuid) from public, anon, authenticated;
revoke all on function public.cgp_order_step_status_changed() from public, anon, authenticated;
revoke all on function public.cgp_scrap_status_changed() from public, anon, authenticated;
