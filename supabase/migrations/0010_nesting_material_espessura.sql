-- =====================================================================
-- 0010: REGRA DE NESTING POR MATERIAL + ESPESSURA
--
-- Um nesting representa uma única combinação de matéria-prima e espessura.
-- Peças de materiais/espessuras diferentes não podem ser misturadas.
-- A chave de material prioriza material_code e usa material como fallback.
-- =====================================================================

alter table public.nestings
  add column if not exists material_code text;

create index if not exists nestings_material_thickness_idx
  on public.nestings (material_code, thickness_mm);

-- Validação centralizada. A regra fica no banco para impedir mistura mesmo
-- que alguém tente inserir/alterar diretamente pela API/Supabase.
create or replace function public.cgp_nesting_material_thickness_guard()
returns trigger
language plpgsql
as $$
declare
  v_n public.nestings;
  v_o public.production_orders;
  v_n_material text;
  v_o_material text;
  v_n_thickness numeric;
  v_o_thickness numeric;
begin
  select * into v_n from public.nestings where id = new.nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;

  select * into v_o from public.production_orders where id = new.production_order_id;
  if not found then
    raise exception 'OP não encontrada.';
  end if;

  v_n_material := nullif(upper(btrim(coalesce(v_n.material_code, v_n.material, ''))), '');
  v_o_material := nullif(upper(btrim(coalesce(v_o.material_code, v_o.material, ''))), '');
  v_n_thickness := v_n.thickness_mm;
  v_o_thickness := v_o.thickness_mm;

  if v_n_material is null then
    update public.nestings
       set material_code = nullif(btrim(coalesce(v_o.material_code, '')), ''),
           material = nullif(btrim(coalesce(v_o.material, '')), '')
     where id = v_n.id;
    v_n_material := v_o_material;
  elsif v_o_material is not null and v_n_material <> v_o_material then
    raise exception 'A OP % possui material "%" e o nesting % está definido para "%". Um nesting só pode conter um material.',
      v_o.op_number, coalesce(v_o.material_code, v_o.material, 'sem material'), v_n.code,
      coalesce(v_n.material_code, v_n.material, 'sem material');
  elsif v_o_material is null then
    raise exception 'A OP % não possui material cadastrado. Informe o material antes de colocá-la em um nesting.', v_o.op_number;
  end if;

  if v_n_thickness is null then
    if v_o_thickness is null then
      raise exception 'A OP % não possui espessura cadastrada. Um nesting precisa ter uma única espessura.', v_o.op_number;
    end if;
    update public.nestings set thickness_mm = v_o_thickness where id = v_n.id;
    v_n_thickness := v_o_thickness;
  elsif v_o_thickness is null then
    raise exception 'A OP % não possui espessura cadastrada. Não é possível misturá-la em um nesting de % mm.', v_o.op_number, v_n_thickness;
  elsif v_n_thickness <> v_o_thickness then
    raise exception 'A OP % possui espessura % mm e o nesting % está em % mm. Um nesting aceita apenas uma espessura.',
      v_o.op_number, v_o_thickness, v_n.code, v_n_thickness;
  end if;

  return new;
end $$;

drop trigger if exists cgp_nesting_material_thickness_guard on public.nesting_order_items;
create trigger cgp_nesting_material_thickness_guard
before insert or update of nesting_id, production_order_id on public.nesting_order_items
for each row execute function public.cgp_nesting_material_thickness_guard();

-- save_nesting agora recebe material_code e valida TODOS os itens antes de gravar.
drop function if exists public.save_nesting(uuid, text, uuid, text, numeric, date, text, jsonb);

create or replace function public.save_nesting(
  p_nesting_id uuid,
  p_code text,
  p_laser_machine_id uuid,
  p_material text,
  p_material_code text,
  p_thickness_mm numeric,
  p_programmed_at date,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n public.nestings;
  v_item jsonb;
  v_qty numeric;
  v_ids uuid[];
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_o public.production_orders;
  v_expected_material text;
  v_expected_thickness numeric;
  v_item_material text;
  v_item_thickness numeric;
  v_first boolean := true;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cadastrar nestings.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' then raise exception 'Informe o código do nesting.'; end if;
  if p_laser_machine_id is null then raise exception 'Selecione a máquina de corte.'; end if;
  if not exists (select 1 from public.laser_machines where id = p_laser_machine_id and active) then raise exception 'Máquina inválida ou inativa.'; end if;
  if p_thickness_mm is not null and p_thickness_mm < 0 then raise exception 'A espessura não pode ser negativa.'; end if;
  if jsonb_typeof(v_items) <> 'array' then raise exception 'Envie as OPs como uma lista.'; end if;

  select array_agg((e ->> 'production_order_id')::uuid) into v_ids from jsonb_array_elements(v_items) e;
  if v_ids is not null and (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception 'Há OPs repetidas na lista do nesting.';
  end if;

  -- Primeiro valida e calcula a chave material + espessura de todas as OPs.
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_qty := nullif(btrim(coalesce(v_item ->> 'quantity_programmed', '')), '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'A quantidade programada de cada OP deve ser maior que zero.'; end if;

    select * into v_o from public.production_orders where id = (v_item ->> 'production_order_id')::uuid;
    if not found then raise exception 'Uma das OPs informadas não foi encontrada.'; end if;

    v_item_material := nullif(upper(btrim(coalesce(v_o.material_code, v_o.material, ''))), '');
    v_item_thickness := v_o.thickness_mm;
    if v_item_material is null then raise exception 'A OP % não possui material cadastrado.', v_o.op_number; end if;
    if v_item_thickness is null then raise exception 'A OP % não possui espessura cadastrada.', v_o.op_number; end if;

    if v_first then
      v_expected_material := v_item_material;
      v_expected_thickness := v_item_thickness;
      v_first := false;
    else
      if v_item_material <> v_expected_material then
        raise exception 'Não é possível misturar materiais no mesmo nesting. A OP % possui "%" e o grupo atual é "%".',
          v_o.op_number, v_item_material, v_expected_material;
      end if;
      if v_item_thickness <> v_expected_thickness then
        raise exception 'Não é possível misturar espessuras no mesmo nesting. A OP % possui % mm e o grupo atual é % mm.',
          v_o.op_number, v_item_thickness, v_expected_thickness;
      end if;
    end if;
  end loop;

  if not v_first then
    if p_thickness_mm is not null and p_thickness_mm <> v_expected_thickness then
      raise exception 'A espessura informada no nesting (% mm) não corresponde às peças selecionadas (% mm).', p_thickness_mm, v_expected_thickness;
    end if;
    if nullif(upper(btrim(coalesce(p_material_code, ''))), '') is not null
       and upper(btrim(p_material_code)) <> v_expected_material then
      raise exception 'O material informado no nesting não corresponde às peças selecionadas.';
    end if;
    p_thickness_mm := v_expected_thickness;
    p_material_code := v_expected_material;
  end if;

  if p_nesting_id is null then
    insert into public.nestings (code, laser_machine_id, material, material_code, thickness_mm, programmed_at, notes)
    values (btrim(p_code), p_laser_machine_id, nullif(btrim(coalesce(p_material, '')), ''), nullif(btrim(coalesce(p_material_code, '')), ''),
            p_thickness_mm, p_programmed_at, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
    insert into public.nesting_history (nesting_id, event_type, to_status, details)
    values (v_id, 'Criado', 'Programado', jsonb_build_object('itens', jsonb_array_length(v_items), 'material_code', p_material_code, 'thickness_mm', p_thickness_mm));
  else
    select * into v_n from public.nestings where id = p_nesting_id for update;
    if not found then raise exception 'Nesting não encontrado.'; end if;
    if v_n.status <> 'Programado' then raise exception 'Só é possível editar nestings Programados (este está %).', v_n.status; end if;
    v_id := p_nesting_id;
    delete from public.nesting_order_items where nesting_id = v_id and (v_ids is null or production_order_id <> all (v_ids));
    update public.nestings
       set code = btrim(p_code), laser_machine_id = p_laser_machine_id,
           material = nullif(btrim(coalesce(p_material, '')), ''),
           material_code = nullif(btrim(coalesce(p_material_code, '')), ''),
           thickness_mm = p_thickness_mm, programmed_at = p_programmed_at,
           notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = v_id;
    insert into public.nesting_history (nesting_id, event_type, from_status, to_status, details)
    values (v_id, 'Editado', 'Programado', 'Programado', jsonb_build_object('itens', jsonb_array_length(v_items), 'material_code', p_material_code, 'thickness_mm', p_thickness_mm));
  end if;

  for v_item in select value from jsonb_array_elements(v_items) order by (value ->> 'production_order_id') loop
    insert into public.nesting_order_items (nesting_id, production_order_id, quantity_programmed, notes, allow_excess)
    values (v_id, (v_item ->> 'production_order_id')::uuid, (v_item ->> 'quantity_programmed')::numeric,
            nullif(btrim(coalesce(v_item ->> 'notes', '')), ''), coalesce((v_item ->> 'allow_excess')::boolean, false))
    on conflict (nesting_id, production_order_id) do update
      set quantity_programmed = excluded.quantity_programmed, notes = excluded.notes, allow_excess = excluded.allow_excess;
  end loop;
  return v_id;
end $$;

-- View com material_code para agrupamento exato.
drop view if exists public.nesting_summary;
create view public.nesting_summary with (security_invoker = true) as
select
  n.id, n.code, n.laser_machine_id, m.name as machine_name, n.material, n.material_code, n.thickness_mm,
  n.status, n.programmed_at, n.notes, n.created_at, n.started_at, n.completed_at,
  coalesce(s.items_count, 0)::integer as items_count,
  coalesce(s.qty_programmed, 0) as qty_programmed,
  coalesce(s.qty_cut, 0) as qty_cut,
  s.list_ids, s.list_names
from public.nestings n
left join public.laser_machines m on m.id = n.laser_machine_id
left join lateral (
  select count(*) as items_count, sum(i.quantity_programmed) as qty_programmed, sum(i.quantity_cut) as qty_cut,
         array_agg(distinct o.list_id) filter (where o.list_id is not null) as list_ids,
         string_agg(distinct coalesce(l.code || ' - ', '') || l.name, ', ') as list_names
    from public.nesting_order_items i
    join public.production_orders o on o.id = i.production_order_id
    left join public.production_lists l on l.id = o.list_id
   where i.nesting_id = n.id
) s on true;

revoke all on function public.save_nesting(uuid, text, uuid, text, text, numeric, date, text, jsonb) from public, anon;
grant execute on function public.save_nesting(uuid, text, uuid, text, text, numeric, date, text, jsonb) to authenticated;
revoke all on public.nesting_summary from anon;
grant select on public.nesting_summary to authenticated;

-- Preenche o código do material em nestings antigos quando todos os itens
-- apontam para a mesma matéria-prima. Nestings históricos inconsistentes ficam
-- sem preenchimento para serem revisados manualmente, sem alterar o histórico.
update public.nestings n
set material_code = g.material_code
from (
  select noi.nesting_id,
         min(nullif(btrim(coalesce(o.material_code, o.material)), '')) as material_code,
         count(distinct upper(btrim(coalesce(o.material_code, o.material, '')))) as material_count,
         count(distinct o.thickness_mm) as thickness_count
    from public.nesting_order_items noi
    join public.production_orders o on o.id = noi.production_order_id
   group by noi.nesting_id
  having count(distinct upper(btrim(coalesce(o.material_code, o.material, '')))) = 1
     and count(distinct o.thickness_mm) = 1
) g
where n.id = g.nesting_id
  and nullif(btrim(coalesce(n.material_code, '')), '') is null;
