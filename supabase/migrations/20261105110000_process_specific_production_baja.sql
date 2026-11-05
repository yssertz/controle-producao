create or replace function public.set_process_steps_done(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_step record;
  v_qty numeric;
  v_count integer := 0;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para apontar processos.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Envie de 1 a 1000 apontamentos.';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_qty := nullif(btrim(coalesce(r->>'quantity_completed','')), '')::numeric;
    select st.id, st.production_order_id, st.quantity_completed as old_qty,
           o.quantity, o.op_number, s.name as process_name
      into v_step
      from public.production_order_steps st
      join public.production_orders o on o.id=st.production_order_id
      join public.production_sectors s on s.id=st.sector_id
     where st.id=(r->>'step_id')::uuid and o.archived_at is null
     for update of st, o;
    if not found then raise exception 'Etapa não encontrada.'; end if;
    if v_qty is null or v_qty < 0 or v_qty > v_step.quantity then
      raise exception 'A quantidade da OP % deve estar entre 0 e %.', v_step.op_number, v_step.quantity;
    end if;
    update public.production_order_steps
       set quantity_completed=v_qty,
           status=case when v_qty >= v_step.quantity then 'Concluída' when v_qty > 0 then 'Parcial' else 'Aguardando' end,
           completed_at=case when v_qty >= v_step.quantity then now() else null end
     where id=v_step.id;
    if v_qty <> v_step.old_qty then
      insert into public.production_logs(order_step_id,quantity,event_type,operator_name,notes)
      values(v_step.id,abs(v_qty-v_step.old_qty),'Baixa por processo',auth.uid()::text,v_step.process_name);
    end if;
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.set_process_steps_done(jsonb) from public, anon;
grant execute on function public.set_process_steps_done(jsonb) to authenticated;
