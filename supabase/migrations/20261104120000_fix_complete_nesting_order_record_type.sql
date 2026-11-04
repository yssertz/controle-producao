-- Corrige o tipo do registro usado ao sincronizar OPs após concluir um nesting.
-- v_item representa nesting_order_items; v_order representa production_orders.
-- A versão anterior tentava armazenar production_orders em v_item, causando
-- conversão de valores como "7.604.500" para UUID.

create or replace function public.complete_nesting(p_nesting_id uuid, p_items jsonb, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_item public.nesting_order_items;
  v_order public.production_orders;
  r jsonb;
  v_cut numeric;
  v_op text;
  v_total integer;
  v_given integer;
  v_distinct integer;
  v_det jsonb := '[]'::jsonb;
  v_qty_done numeric;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para concluir o nesting.' using errcode = '42501';
  end if;

  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then raise exception 'Nesting não encontrado.'; end if;
  if v_n.status <> 'Em produção' then
    raise exception 'Só é possível concluir um nesting Em produção (este está %).', v_n.status;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Envie a conferência das quantidades.';
  end if;

  select count(*) into v_total
  from public.nesting_order_items where nesting_id = p_nesting_id;

  select count(*), count(distinct (e ->> 'production_order_id'))
    into v_given, v_distinct
  from jsonb_array_elements(p_items) e;

  if v_total = 0 then raise exception 'O nesting não possui OPs vinculadas.'; end if;
  if v_given <> v_total or v_distinct <> v_total then
    raise exception 'Confirme a quantidade cortada de TODAS as OPs do nesting (esperado: %, recebido: %).', v_total, v_given;
  end if;

  for r in select value from jsonb_array_elements(p_items) loop
    select * into v_item
    from public.nesting_order_items
    where nesting_id = p_nesting_id
      and production_order_id = (r ->> 'production_order_id')::uuid
    for update;

    if not found then raise exception 'Um dos itens informados não pertence a este nesting.'; end if;
    select op_number into v_op from public.production_orders where id = v_item.production_order_id;

    v_cut := nullif(btrim(coalesce(r ->> 'quantity_cut', '')), '')::numeric;
    if v_cut is null or v_cut < 0 then
      raise exception 'Informe uma quantidade cortada válida (zero ou mais) para a OP %.', v_op;
    end if;
    if v_cut > v_item.quantity_programmed then
      raise exception 'A quantidade cortada (%) da OP % não pode ultrapassar a programada (%).',
        public.cgp_fmt_qty(v_cut), v_op, public.cgp_fmt_qty(v_item.quantity_programmed);
    end if;

    update public.nesting_order_items set quantity_cut = v_cut where id = v_item.id;
    v_det := v_det || jsonb_build_array(jsonb_build_object(
      'op', v_op, 'programado', v_item.quantity_programmed, 'cortado', v_cut
    ));
  end loop;

  perform set_config('cgp.transicao', 'on', true);
  update public.nestings
     set status = 'Concluído', completed_at = now()
   where id = p_nesting_id;
  perform set_config('cgp.transicao', 'off', true);

  -- OPs cujo único processo é laser: sincroniza a conclusão final.
  -- Linhas com processos adicionais permanecem abertas para os demais processos.
  for v_order in
    select distinct o.*
    from public.production_orders o
    join public.production_lines pl on pl.id = o.production_line_id
    join public.nesting_order_items ni on ni.production_order_id = o.id
    where ni.nesting_id = p_nesting_id
      and pl.name in ('LASER 6KW', 'LASER 6KW/40KW', 'LASER 40KW', 'LASER 12KW')
  loop
    select least(v_order.quantity, coalesce(sum(ni.quantity_cut), 0))
      into v_qty_done
    from public.nesting_order_items ni
    join public.nestings nn on nn.id = ni.nesting_id
    where ni.production_order_id = v_order.id
      and nn.status = 'Concluído';

    update public.production_orders
       set qty_done = v_qty_done,
           status = case
             when status = 'Bloqueada' then status
             when v_qty_done >= quantity then 'Concluída'
             when v_qty_done > 0 then 'Parcial'
             else 'Aguardando'
           end
     where id = v_order.id;
  end loop;

  insert into public.nesting_history
    (nesting_id, event_type, from_status, to_status, note, details)
  values
    (p_nesting_id, 'Concluído', 'Em produção', 'Concluído',
     nullif(btrim(coalesce(p_note, '')), ''),
     jsonb_build_object('itens', v_det));
end
$$;
