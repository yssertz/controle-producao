-- =====================================================================
-- 0010: ESPESSURA DAS PEÇAS (filtro por espessura)
--   - A espessura (mm) é calculada na tela a partir da descrição da matéria-prima
--     (ex.: "CHAPA 3/8 ... (9,50 mm)" -> 9,5) e gravada em production_orders.thickness_mm.
--   - import_items_erp passa a gravar a espessura enviada pela tela.
--   - set_items_thickness: grava a espessura de itens já cadastrados (botão "Calcular espessuras").
--   - item_thicknesses: lista as espessuras existentes (para os filtros).
-- Pode ser executada mais de uma vez.
-- =====================================================================

create index if not exists production_orders_thickness_idx on public.production_orders (thickness_mm);

create or replace function public.import_items_erp(
  p_list_id uuid,
  p_rows jsonb,
  p_default_line_id uuid default null,
  p_skip_duplicates boolean default true
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_idx integer := 0;
  v_row integer;
  v_op text; v_item text; v_desc text; v_mcode text; v_munit text; v_mdesc text;
  v_qty numeric; v_mqty numeric; v_line uuid;
  v_ecode integer; v_explicit boolean; v_unit text; v_thick numeric;
  v_inserted integer := 0;
  v_dups integer := 0;
  v_noline integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_dup_rows jsonb := '[]'::jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cadastrar itens.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma linha para importar.';
  end if;
  if jsonb_array_length(p_rows) > 3000 then
    raise exception 'Importe no máximo 3000 linhas por vez.';
  end if;
  if not exists (select 1 from public.production_lists where id = p_list_id and status <> 'Arquivada') then
    raise exception 'Lista inexistente ou arquivada.';
  end if;
  if p_default_line_id is not null
     and not exists (select 1 from public.production_lines where id = p_default_line_id and active) then
    raise exception 'Linha padrão inexistente ou inativa.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_row := coalesce((r ->> 'row')::integer, v_idx);
    begin
      v_op    := nullif(btrim(coalesce(r ->> 'op_number', '')), '');
      v_item  := nullif(btrim(coalesce(r ->> 'item_code', '')), '');
      v_desc  := nullif(btrim(coalesce(r ->> 'description', '')), '');
      v_mcode := nullif(btrim(coalesce(r ->> 'material_code', '')), '');
      v_munit := nullif(btrim(coalesce(r ->> 'material_unit', '')), '');
      v_mdesc := nullif(btrim(coalesce(r ->> 'material', '')), '');
      v_qty   := nullif(btrim(coalesce(r ->> 'quantity', '')), '')::numeric;
      v_mqty  := nullif(btrim(coalesce(r ->> 'material_qty', '')), '')::numeric;
      v_thick := nullif(btrim(coalesce(r ->> 'thickness_mm', '')), '')::numeric;
      v_unit  := coalesce(nullif(btrim(coalesce(r ->> 'item_unit', '')), ''), 'un');
      v_ecode := nullif(btrim(coalesce(r ->> 'erp_line_code', '')), '')::integer;

      if v_op is null then raise exception 'OP é obrigatória.'; end if;
      if v_item is null then raise exception 'Código do item é obrigatório.'; end if;
      if v_qty is null or v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;

      -- 1) código de linha do ERP vindo da própria planilha (coluna "Linha"), se conhecido
      v_line := null;
      v_explicit := false;
      if v_ecode is not null and exists (select 1 from public.erp_line_codes where code = v_ecode) then
        v_explicit := true;
        select e.line_id into v_line
          from public.erp_line_codes e
          join public.production_lines pl on pl.id = e.line_id and pl.active
         where e.code = v_ecode;
      end if;
      -- 2) senão, o catálogo item -> linha
      if not v_explicit then
        select e.line_id into v_line
          from public.item_line_catalog c
          join public.erp_line_codes e on e.code = c.erp_line_code
          join public.production_lines pl on pl.id = e.line_id and pl.active
         where c.item_code = upper(v_item);
      end if;
      -- 3) senão, a linha padrão escolhida pelo usuário
      if v_line is null then
        v_line := p_default_line_id;
      end if;
      if v_line is null then
        v_noline := v_noline + 1;
        continue;
      end if;

      if p_skip_duplicates and exists (
        select 1 from public.production_orders o
         where o.list_id = p_list_id and o.production_line_id = v_line and o.archived_at is null
           and upper(btrim(o.op_number)) = upper(v_op)
           and coalesce(upper(btrim(o.item_code)), '') = upper(v_item)
           and coalesce(upper(btrim(o.material_code)), '') = coalesce(upper(v_mcode), '')
      ) then
        v_dups := v_dups + 1;
        v_dup_rows := v_dup_rows || to_jsonb(v_row);
        continue;
      end if;

      insert into public.production_orders
        (list_id, production_line_id, op_number, item_code, description, quantity, unit,
         material, material_code, material_qty, material_unit, thickness_mm)
      values
        (p_list_id, v_line, v_op, v_item, v_desc, v_qty, v_unit, v_mdesc, v_mcode, v_mqty, v_munit, v_thick);
      v_inserted := v_inserted + 1;

    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_dups, 'duplicate_rows', v_dup_rows,
    'no_line', v_noline, 'errors', v_errors);
end $$;

create or replace function public.set_items_thickness(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para alterar itens.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Envie as linhas como uma lista.';
  end if;
  if jsonb_array_length(p_rows) > 3000 then
    raise exception 'Envie no máximo 3000 linhas por chamada.';
  end if;

  update public.production_orders o
     set thickness_mm = (e ->> 'thickness_mm')::numeric
    from jsonb_array_elements(p_rows) e
   where o.id = (e ->> 'id')::uuid
     and (e ->> 'thickness_mm') is not null
     and (e ->> 'thickness_mm')::numeric > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Espessuras existentes (e quantos itens têm cada uma). Respeita o RLS de quem consulta.
create or replace function public.item_thicknesses(
  p_list_id uuid default null,
  p_only_nestable boolean default true,
  p_only_pending boolean default true
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('thickness_mm', x.t, 'items', x.n) order by x.t nulls last), '[]'::jsonb)
    from (
      select b.thickness_mm as t, count(*) as n
        from public.production_item_balance b
       where b.archived_at is null
         and (not p_only_nestable or b.line_allows_nesting)
         and (not p_only_pending or b.qty_unscheduled > 0)
         and (p_list_id is null or b.list_id = p_list_id)
       group by b.thickness_mm
    ) x;
$$;

revoke all on function public.import_items_erp(uuid, jsonb, uuid, boolean) from public, anon;
revoke all on function public.set_items_thickness(jsonb) from public, anon;
revoke all on function public.item_thicknesses(uuid, boolean, boolean) from public, anon;
grant execute on function public.import_items_erp(uuid, jsonb, uuid, boolean) to authenticated;
grant execute on function public.set_items_thickness(jsonb) to authenticated;
grant execute on function public.item_thicknesses(uuid, boolean, boolean) to authenticated;
