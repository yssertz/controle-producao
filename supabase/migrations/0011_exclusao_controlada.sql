-- =====================================================================
-- 0011: EXCLUSÃO CONTROLADA DE LISTAS, OPs E NESTINGS
--
-- Exclusão definitiva fica disponível para admin/PCP, mas com travas de
-- integridade para impedir apagar histórico de produção por acidente.
--
-- Regras:
--   * Nesting: pode ser excluído se estiver Programado ou Cancelado e sem
--     quantidade cortada. Histórico e vínculos são removidos junto.
--   * OP: só pode ser excluída se não estiver vinculada a nenhum nesting.
--   * Lista: só pode ser excluída se nenhuma OP dela estiver vinculada a
--     nesting. As OPs, etapas e logs da lista são removidos junto.
-- =====================================================================

create or replace function public.delete_nesting(p_nesting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_qty_cut numeric;
begin
  if not public.cgp_can_plan() then
    raise exception using errcode = '42501', message = 'Somente administradores e PCP podem excluir nestings.';
  end if;

  select n.status, coalesce(sum(i.quantity_cut), 0)
    into v_status, v_qty_cut
    from public.nestings n
    left join public.nesting_order_items i on i.nesting_id = n.id
   where n.id = p_nesting_id
   group by n.id, n.status;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Nesting não encontrado.';
  end if;

  if v_qty_cut > 0 then
    raise exception using errcode = 'P0001', message = 'Este nesting já possui peças cortadas e não pode ser excluído. Cancele ou mantenha o histórico.';
  end if;

  if v_status not in ('Programado', 'Cancelado') then
    raise exception using errcode = 'P0001', message = 'Só é possível excluir nestings Programados ou Cancelados sem peças cortadas.';
  end if;

  delete from public.nestings where id = p_nesting_id;
end;
$$;

create or replace function public.delete_production_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op text;
  v_links integer;
begin
  if not public.cgp_can_plan() then
    raise exception using errcode = '42501', message = 'Somente administradores e PCP podem excluir OPs.';
  end if;

  select op_number into v_op from public.production_orders where id = p_order_id;
  if v_op is null then
    raise exception using errcode = 'P0002', message = 'OP não encontrada.';
  end if;

  select count(*) into v_links from public.nesting_order_items where production_order_id = p_order_id;
  if v_links > 0 then
    raise exception using errcode = 'P0001', message = format('A OP %s está vinculada a um ou mais nestings. Exclua primeiro os nestings relacionados ou remova a OP deles.', v_op);
  end if;

  delete from public.production_orders where id = p_order_id;
end;
$$;

create or replace function public.delete_production_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_orders integer;
  v_links integer;
begin
  if not public.cgp_can_plan() then
    raise exception using errcode = '42501', message = 'Somente administradores e PCP podem excluir listas.';
  end if;

  select name into v_name from public.production_lists where id = p_list_id;
  if v_name is null then
    raise exception using errcode = 'P0002', message = 'Lista não encontrada.';
  end if;

  select count(*) into v_orders from public.production_orders where list_id = p_list_id;
  select count(*)
    into v_links
    from public.nesting_order_items noi
    join public.production_orders o on o.id = noi.production_order_id
   where o.list_id = p_list_id;

  if v_links > 0 then
    raise exception using errcode = 'P0001', message = format('A lista "%s" possui OPs vinculadas a nestings. Exclua primeiro os nestings relacionados.', v_name);
  end if;

  -- production_order_steps e logs possuem ON DELETE CASCADE.
  delete from public.production_orders where list_id = p_list_id;
  delete from public.production_lists where id = p_list_id;
end;
$$;

revoke all on function public.delete_nesting(uuid) from public, anon;
revoke all on function public.delete_production_order(uuid) from public, anon;
revoke all on function public.delete_production_list(uuid) from public, anon;
grant execute on function public.delete_nesting(uuid) to authenticated;
grant execute on function public.delete_production_order(uuid) to authenticated;
grant execute on function public.delete_production_list(uuid) to authenticated;
