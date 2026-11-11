alter table public.nesting_order_items
  drop constraint if exists nesting_order_items_manual_fields_ck;
alter table public.nesting_order_items
  add constraint nesting_order_items_manual_fields_ck
  check (
    production_order_id is not null
    or (
      op_number is not null and btrim(op_number) <> ''
      and equipment_name is not null and btrim(equipment_name) <> ''
      and description is not null and btrim(description) <> ''
      and material is not null and btrim(material) <> ''
      and thickness_mm is not null and thickness_mm > 0
    )
  );

create or replace function public.cgp_noi_guard()
returns trigger language plpgsql as $$
declare
  v_n public.nestings;
  v_o public.production_orders;
  v_alloc numeric;
begin
  if tg_op = 'DELETE' then
    select * into v_n from public.nestings where id = old.nesting_id;
    if found and v_n.status <> 'Programado' and coalesce(current_setting('cgp.transicao', true), '') <> 'on' then
      raise exception 'Só é possível remover peças de um nesting Programado (o nesting % está %).', v_n.code, v_n.status;
    end if;
    return old;
  end if;

  select * into v_n from public.nestings where id = new.nesting_id;
  if not found then raise exception 'Nesting não encontrado.'; end if;

  if new.quantity_programmed <= 0 or new.quantity_cut < 0 or new.quantity_cut > new.quantity_programmed then
    raise exception 'As quantidades programada/cortada da peça são inválidas.';
  end if;

  if new.production_order_id is null then
    if tg_op = 'INSERT' then
      if v_n.status <> 'Programado' then raise exception 'Só é possível adicionar peças avulsas a um nesting Programado.'; end if;
      if new.quantity_cut <> 0 then raise exception 'Uma peça avulsa em nesting Programado não pode ter quantidade cortada.'; end if;
    else
      if new.nesting_id <> old.nesting_id or new.production_order_id is distinct from old.production_order_id then
        raise exception 'Não é permitido trocar o nesting ou o vínculo de uma peça avulsa.';
      end if;
      if v_n.status <> 'Programado' and (
        new.op_number is distinct from old.op_number
        or new.equipment_name is distinct from old.equipment_name
        or new.description is distinct from old.description
        or new.material is distinct from old.material
        or new.thickness_mm is distinct from old.thickness_mm
        or new.quantity_programmed is distinct from old.quantity_programmed
        or new.allow_excess is distinct from old.allow_excess
      ) then
        raise exception 'Os dados da peça avulsa só podem ser alterados em nesting Programado.';
      end if;
      if new.quantity_cut is distinct from old.quantity_cut and v_n.status <> 'Em produção' then
        raise exception 'A quantidade cortada só pode ser registrada em nesting Em produção.';
      end if;
    end if;
    if nullif(btrim(new.op_number), '') is null
      or nullif(btrim(new.equipment_name), '') is null
      or nullif(btrim(new.description), '') is null
      or nullif(btrim(new.material), '') is null
      or new.thickness_mm is null or new.thickness_mm <= 0 then
      raise exception 'Preencha OP, equipamento, descrição, material e espessura da peça avulsa.';
    end if;
    return new;
  end if;

  select * into v_o from public.production_orders where id = new.production_order_id for update;
  if not found then raise exception 'Item de produção não encontrado.'; end if;

  if tg_op = 'INSERT' then
    if v_n.status <> 'Programado' then raise exception 'Só é possível vincular OPs a um nesting Programado (o nesting % está %).', v_n.code, v_n.status; end if;
    if v_o.archived_at is not null then raise exception 'O item da OP % está arquivado.', v_o.op_number; end if;
    if new.quantity_cut <> 0 then raise exception 'Um nesting Programado não pode ter quantidade cortada.'; end if;
  else
    if new.nesting_id <> old.nesting_id or new.production_order_id <> old.production_order_id then
      raise exception 'Não é permitido trocar o nesting ou a OP de um vínculo existente.';
    end if;
    if (new.quantity_programmed <> old.quantity_programmed or new.allow_excess <> old.allow_excess) and v_n.status <> 'Programado' then
      raise exception 'A quantidade programada só pode ser alterada em nesting Programado (o nesting % está %).', v_n.code, v_n.status;
    end if;
    if new.quantity_cut <> old.quantity_cut and v_n.status <> 'Em produção' then
      raise exception 'A quantidade cortada só pode ser registrada em nesting Em produção (o nesting % está %).', v_n.code, v_n.status;
    end if;
  end if;

  if tg_op = 'INSERT' or new.quantity_programmed <> old.quantity_programmed or new.allow_excess <> old.allow_excess then
    v_alloc := public.cgp_item_allocated(new.production_order_id, new.nesting_id);
    if v_alloc + new.quantity_programmed > v_o.quantity and not new.allow_excess then
      raise exception using errcode='CG001',
        message=format('EXCESSO: a OP %s (%s) precisa de %s, já há %s em outros nestings e este nesting pede %s (total %s). Confirme explicitamente para programar excedente.',
          v_o.op_number, coalesce(v_o.item_code,v_o.description,'sem código'),
          public.cgp_fmt_qty(v_o.quantity), public.cgp_fmt_qty(v_alloc),
          public.cgp_fmt_qty(new.quantity_programmed), public.cgp_fmt_qty(v_alloc+new.quantity_programmed));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cgp_nesting_material_thickness_guard on public.nesting_order_items;
create trigger cgp_nesting_material_thickness_guard
before insert or update of nesting_id, production_order_id, material, thickness_mm
on public.nesting_order_items
for each row execute function public.cgp_nesting_material_thickness_guard();
