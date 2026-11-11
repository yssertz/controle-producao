-- Permite adicionar peças avulsas diretamente ao nesting, mantendo OPs cadastradas.
alter table public.nesting_order_items
  alter column production_order_id drop not null,
  add column if not exists op_number text,
  add column if not exists equipment_name text,
  add column if not exists description text,
  add column if not exists material text,
  add column if not exists thickness_mm numeric;

alter table public.nesting_order_items
  drop constraint if exists nesting_order_items_nesting_id_production_order_id_key;

create unique index if not exists nesting_order_items_nesting_order_unique
  on public.nesting_order_items(nesting_id, production_order_id)
  where production_order_id is not null;

alter table public.nesting_order_items
  add constraint nesting_order_items_manual_fields_ck
  check (
    (production_order_id is not null)
    or (
      nullif(btrim(op_number), '') is not null
      and nullif(btrim(equipment_name), '') is not null
      and nullif(btrim(description), '') is not null
      and nullif(btrim(material), '') is not null
      and thickness_mm > 0
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

  if new.production_order_id is null then
    if v_n.status <> 'Programado' then
      raise exception 'Só é possível adicionar peças avulsas a um nesting Programado.';
    end if;
    if new.quantity_cut < 0 or new.quantity_cut > new.quantity_programmed then
      raise exception 'Quantidade cortada inválida para a peça avulsa.';
    end if;
    if tg_op = 'INSERT' and new.quantity_cut <> 0 then
      raise exception 'Uma peça avulsa em nesting Programado não pode ter quantidade cortada.';
    end if;
    if tg_op = 'UPDATE' and new.quantity_cut <> old.quantity_cut and v_n.status <> 'Em produção' then
      raise exception 'A quantidade cortada só pode ser registrada em nesting Em produção.';
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

  if new.quantity_cut < 0 or new.quantity_cut > new.quantity_programmed then
    raise exception 'Quantidade cortada inválida para a OP %.', v_o.op_number;
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

create or replace function public.cgp_noi_line_guard()
returns trigger language plpgsql as $$
declare v_ok boolean; v_line text; v_op text;
begin
  if new.production_order_id is null then return new; end if;
  if exists(select 1 from public.nesting_order_items where nesting_id=new.nesting_id and production_order_id=new.production_order_id) then return new; end if;
  select pl.allows_nesting, pl.name, o.op_number into v_ok,v_line,v_op
    from public.production_orders o left join public.production_lines pl on pl.id=o.production_line_id
   where o.id=new.production_order_id;
  if not coalesce(v_ok,false) then
    raise exception 'A OP % está na linha "%" e não pode entrar em nesting: nestings aceitam apenas peças de linhas de laser habilitadas.',v_op,coalesce(v_line,'sem linha');
  end if;
  return new;
end $$;

create or replace function public.cgp_nesting_material_thickness_guard()
returns trigger language plpgsql set search_path=public as $$
declare
  v_n public.nestings;
  v_o public.production_orders;
  v_n_type text;
  v_o_type text;
  v_piece_material text;
  v_piece_thickness numeric;
  v_piece_label text;
begin
  select * into v_n from public.nestings where id=new.nesting_id for update;
  if not found then raise exception 'Nesting não encontrado.'; end if;

  if new.production_order_id is null then
    v_piece_material:=new.material;
    v_piece_thickness:=new.thickness_mm;
    v_piece_label:=new.op_number;
  else
    select * into v_o from public.production_orders where id=new.production_order_id;
    if not found then raise exception 'OP não encontrada.'; end if;
    v_piece_material:=coalesce(v_o.material_code,v_o.material);
    v_piece_thickness:=v_o.thickness_mm;
    v_piece_label:=v_o.op_number;
  end if;

  v_n_type:=coalesce(v_n.sheet_material_type,public.cgp_classify_sheet_material(v_n.material_code),public.cgp_classify_sheet_material(v_n.material));
  v_o_type:=public.cgp_classify_sheet_material(v_piece_material);
  if v_o_type is null then raise exception 'A OP/peça avulsa % possui material não identificado para nesting (%).',v_piece_label,coalesce(v_piece_material,'sem descrição'); end if;
  if v_n_type='A36_SAE1010_20_LNE' then
    if v_o_type not in ('A36_SAE1010_20_LNE','A36_SAE1010_20_NORMAL') then raise exception 'A OP/peça avulsa % possui material incompatível com a chapa LNE.',v_piece_label; end if;
  elsif v_n_type is distinct from v_o_type then
    raise exception 'A OP/peça avulsa % possui material incompatível com o tipo de chapa selecionado.',v_piece_label;
  end if;

  if v_piece_thickness is null or v_piece_thickness<=0 then raise exception 'A OP/peça avulsa % precisa ter espessura válida.',v_piece_label; end if;
  if v_n.thickness_mm is null then
    update public.nestings set thickness_mm=v_piece_thickness where id=v_n.id;
  elsif v_n.thickness_mm<>v_piece_thickness then
    raise exception 'A OP/peça avulsa % possui espessura % mm e o nesting % está em % mm. Um nesting aceita apenas uma espessura.',v_piece_label,v_piece_thickness,v_n.code,v_n.thickness_mm;
  end if;
  return new;
end $$;

create or replace function public.save_nesting(
 p_nesting_id uuid,p_code text,p_laser_machine_id uuid,p_material text,p_material_code text,
 p_sheet_material_type text,p_thickness_mm numeric,p_programmed_at date,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_n public.nestings; v_item jsonb; v_qty numeric; v_ids uuid[];
 v_items jsonb:=coalesce(p_items,'[]'::jsonb); v_o public.production_orders;
 v_item_type text; v_first boolean:=true; v_piece_type text; v_piece_thickness numeric;
 v_op text; v_material text; v_description text; v_equipment text;
begin
 if not public.cgp_can_plan() then raise exception 'Você não tem permissão para cadastrar nestings.' using errcode='42501'; end if;
 if btrim(coalesce(p_code,''))='' then raise exception 'Informe o código do nesting.'; end if;
 if p_laser_machine_id is null or not exists(select 1 from public.laser_machines where id=p_laser_machine_id and active) then raise exception 'Selecione uma máquina válida e ativa.'; end if;
 if p_sheet_material_type is null or p_sheet_material_type not in ('A36_SAE1010_20_NORMAL','A36_SAE1010_20_LNE','GALVANIZADA','INOX','HARDOX','STRENX','ANTIDERRAPANTE') then raise exception 'Selecione um tipo de chapa válido.'; end if;
 if p_thickness_mm is not null and p_thickness_mm<=0 then raise exception 'A espessura deve ser maior que zero.'; end if;
 if jsonb_typeof(v_items)<>'array' then raise exception 'Envie as peças como uma lista.'; end if;

 select array_agg((e->>'production_order_id')::uuid) into v_ids
 from jsonb_array_elements(v_items)e where nullif(e->>'production_order_id','') is not null;
 if v_ids is not null and (select count(distinct x) from unnest(v_ids)x)<>array_length(v_ids,1) then raise exception 'Há OPs repetidas na lista do nesting.'; end if;

 for v_item in select value from jsonb_array_elements(v_items) loop
  v_qty:=nullif(btrim(coalesce(v_item->>'quantity_programmed','')),'')::numeric;
  if v_qty is null or v_qty<=0 then raise exception 'A quantidade programada de cada peça deve ser maior que zero.'; end if;
  if nullif(v_item->>'production_order_id','') is not null then
   select * into v_o from public.production_orders where id=(v_item->>'production_order_id')::uuid;
   if not found then raise exception 'Uma das OPs informadas não foi encontrada.'; end if;
   v_op:=v_o.op_number; v_material:=coalesce(v_o.material_code,v_o.material);
   v_piece_type:=public.cgp_classify_sheet_material(v_material); v_piece_thickness:=v_o.thickness_mm;
   if v_piece_type is null then raise exception 'A OP % possui matéria-prima não identificada para nesting (%).',v_op,coalesce(v_material,'sem descrição'); end if;
   if v_piece_thickness is null then raise exception 'A OP % não possui espessura cadastrada.',v_op; end if;
  else
   v_op:=nullif(btrim(v_item->>'op_number'),'');
   v_equipment:=nullif(btrim(v_item->>'equipment_name'),'');
   v_description:=nullif(btrim(v_item->>'description'),'');
   v_material:=nullif(btrim(v_item->>'material'),'');
   v_piece_thickness:=nullif(btrim(v_item->>'thickness_mm'),'')::numeric;
   if v_op is null or v_equipment is null or v_description is null or v_material is null or v_piece_thickness is null or v_piece_thickness<=0 then
     raise exception 'Preencha OP, equipamento, descrição, material e espessura da peça avulsa.';
   end if;
   v_piece_type:=public.cgp_classify_sheet_material(v_material);
   if v_piece_type is null then raise exception 'O material da peça avulsa % não foi identificado para nesting (%).',v_op,v_material; end if;
  end if;

  if p_sheet_material_type='A36_SAE1010_20_LNE' then
   if v_piece_type not in ('A36_SAE1010_20_LNE','A36_SAE1010_20_NORMAL') then raise exception 'A OP/peça avulsa % possui material incompatível com a chapa LNE.',v_op; end if;
  elsif v_piece_type<>p_sheet_material_type then raise exception 'A OP/peça avulsa % possui material incompatível com o tipo de chapa selecionado.',v_op;
  end if;

  if v_first then
   if p_thickness_mm is not null and p_thickness_mm<>v_piece_thickness then raise exception 'A espessura informada no nesting (% mm) não corresponde à OP/peça % (% mm).',p_thickness_mm,v_op,v_piece_thickness; end if;
   p_thickness_mm:=v_piece_thickness; v_first:=false;
  elsif v_piece_thickness<>p_thickness_mm then
   raise exception 'Não é possível misturar espessuras no mesmo nesting. A OP/peça % possui % mm e o nesting usa % mm.',v_op,v_piece_thickness,p_thickness_mm;
  end if;
 end loop;

 if p_nesting_id is null then
  insert into public.nestings(code,laser_machine_id,material,material_code,sheet_material_type,thickness_mm,programmed_at,notes)
  values(btrim(p_code),p_laser_machine_id,nullif(btrim(coalesce(p_material,'')),''),nullif(btrim(coalesce(p_material_code,'')),''),p_sheet_material_type,p_thickness_mm,p_programmed_at,nullif(btrim(coalesce(p_notes,'')),'')) returning id into v_id;
  insert into public.nesting_history(nesting_id,event_type,to_status,details)
  values(v_id,'Criado','Programado',jsonb_build_object('itens',jsonb_array_length(v_items),'sheet_material_type',p_sheet_material_type,'thickness_mm',p_thickness_mm));
 else
  select * into v_n from public.nestings where id=p_nesting_id for update;
  if not found then raise exception 'Nesting não encontrado.'; end if;
  if v_n.status<>'Programado' then raise exception 'Só é possível editar nestings Programados (este está %).',v_n.status; end if;
  v_id:=p_nesting_id;
  delete from public.nesting_order_items where nesting_id=v_id;
  update public.nestings set code=btrim(p_code),laser_machine_id=p_laser_machine_id,material=nullif(btrim(coalesce(p_material,'')), ''),
   material_code=nullif(btrim(coalesce(p_material_code,'')),''),sheet_material_type=p_sheet_material_type,thickness_mm=p_thickness_mm,
   programmed_at=p_programmed_at,notes=nullif(btrim(coalesce(p_notes,'')),'') where id=v_id;
  insert into public.nesting_history(nesting_id,event_type,from_status,to_status,details)
  values(v_id,'Editado','Programado','Programado',jsonb_build_object('itens',jsonb_array_length(v_items),'sheet_material_type',p_sheet_material_type,'thickness_mm',p_thickness_mm));
 end if;

 for v_item in select value from jsonb_array_elements(v_items) loop
  v_qty:=(v_item->>'quantity_programmed')::numeric;
  if nullif(v_item->>'production_order_id','') is not null then
   insert into public.nesting_order_items(nesting_id,production_order_id,quantity_programmed,notes,allow_excess)
   values(v_id,(v_item->>'production_order_id')::uuid,v_qty,nullif(btrim(coalesce(v_item->>'notes','')),''),coalesce((v_item->>'allow_excess')::boolean,false))
   on conflict(nesting_id,production_order_id) where production_order_id is not null
   do update set quantity_programmed=excluded.quantity_programmed,notes=excluded.notes,allow_excess=excluded.allow_excess;
  else
   insert into public.nesting_order_items(nesting_id,production_order_id,op_number,equipment_name,description,material,thickness_mm,quantity_programmed,quantity_cut,allow_excess)
   values(v_id,null,btrim(v_item->>'op_number'),btrim(v_item->>'equipment_name'),btrim(v_item->>'description'),
          btrim(v_item->>'material'),(v_item->>'thickness_mm')::numeric,v_qty,0,false);
  end if;
 end loop;
 return v_id;
end $$;

create or replace function public.record_nesting_cut(p_nesting_id uuid,p_items jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_n public.nestings; v_item public.nesting_order_items; r jsonb; v_cut numeric; v_label text; v_det jsonb:='[]'::jsonb;
begin
 if not public.cgp_can_operate() then raise exception 'Você não tem permissão para registrar quantidades.' using errcode='42501'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Nenhuma quantidade informada.'; end if;
 select * into v_n from public.nestings where id=p_nesting_id for update;
 if not found then raise exception 'Nesting não encontrado.'; end if;
 if v_n.status<>'Em produção' then raise exception 'Só é possível registrar quantidades em um nesting Em produção (este está %).',v_n.status; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  select * into v_item from public.nesting_order_items where nesting_id=p_nesting_id and id=(r->>'nesting_item_id')::uuid for update;
  if not found then raise exception 'Um dos itens informados não pertence a este nesting.'; end if;
  v_label:=case when v_item.production_order_id is not null then (select op_number from public.production_orders where id=v_item.production_order_id) else v_item.op_number end;
  v_cut:=nullif(btrim(coalesce(r->>'quantity_cut','')),'')::numeric;
  if v_cut is null or v_cut<0 or v_cut>v_item.quantity_programmed then raise exception 'Quantidade cortada inválida para OP/peça %.',v_label; end if;
  if v_cut<>v_item.quantity_cut then
   update public.nesting_order_items set quantity_cut=v_cut where id=v_item.id;
   v_det:=v_det||jsonb_build_array(jsonb_build_object('op',v_label,'antes',v_item.quantity_cut,'depois',v_cut));
  end if;
 end loop;
 insert into public.nesting_history(nesting_id,event_type,from_status,to_status,details)
 values(p_nesting_id,'Quantidades registradas','Em produção','Em produção',jsonb_build_object('alteracoes',v_det));
end $$;

create or replace function public.complete_nesting(p_nesting_id uuid,p_items jsonb,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_n public.nestings; v_item public.nesting_order_items; v_order public.production_orders;
 r jsonb; v_cut numeric; v_label text; v_total integer; v_given integer; v_distinct integer;
 v_det jsonb:='[]'::jsonb; v_qty_done numeric;
begin
 if not public.cgp_can_operate() then raise exception 'Você não tem permissão para concluir o nesting.' using errcode='42501'; end if;
 select * into v_n from public.nestings where id=p_nesting_id for update;
 if not found then raise exception 'Nesting não encontrado.'; end if;
 if v_n.status<>'Em produção' then raise exception 'Só é possível concluir um nesting Em produção (este está %).',v_n.status; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Envie a conferência das quantidades.'; end if;
 select count(*) into v_total from public.nesting_order_items where nesting_id=p_nesting_id;
 select count(*),count(distinct(e->>'nesting_item_id')) into v_given,v_distinct from jsonb_array_elements(p_items)e;
 if v_total=0 then raise exception 'O nesting não possui peças vinculadas.'; end if;
 if v_given<>v_total or v_distinct<>v_total then raise exception 'Confirme a quantidade cortada de TODAS as peças do nesting (esperado: %, recebido: %).',v_total,v_given; end if;
 for r in select value from jsonb_array_elements(p_items) loop
  select * into v_item from public.nesting_order_items where nesting_id=p_nesting_id and id=(r->>'nesting_item_id')::uuid for update;
  if not found then raise exception 'Um dos itens informados não pertence a este nesting.'; end if;
  v_label:=case when v_item.production_order_id is not null then (select op_number from public.production_orders where id=v_item.production_order_id) else v_item.op_number end;
  v_cut:=nullif(btrim(coalesce(r->>'quantity_cut','')),'')::numeric;
  if v_cut is null or v_cut<0 then raise exception 'Informe quantidade cortada válida para OP/peça %.',v_label; end if;
  if v_cut>v_item.quantity_programmed then raise exception 'Quantidade cortada da OP/peça % não pode ultrapassar a programada.',v_label; end if;
  update public.nesting_order_items set quantity_cut=v_cut where id=v_item.id;
  v_det:=v_det||jsonb_build_array(jsonb_build_object('op',v_label,'programado',v_item.quantity_programmed,'cortado',v_cut));
 end loop;

 perform set_config('cgp.transicao','on',true);
 update public.nestings set status='Concluído',completed_at=now() where id=p_nesting_id;
 perform set_config('cgp.transicao','off',true);

 for v_order in
  select distinct o.* from public.production_orders o
  join public.production_lines pl on pl.id=o.production_line_id
  join public.nesting_order_items ni on ni.production_order_id=o.id
  where ni.nesting_id=p_nesting_id and pl.name in ('LASER 6KW','LASER 6KW/40KW','LASER 40KW','LASER 12KW')
 loop
  select least(v_order.quantity,coalesce(sum(ni.quantity_cut),0)) into v_qty_done
  from public.nesting_order_items ni join public.nestings nn on nn.id=ni.nesting_id
  where ni.production_order_id=v_order.id and nn.status='Concluído';
  update public.production_orders set qty_done=v_qty_done,status=case
    when status='Bloqueada' then status when v_qty_done>=quantity then 'Concluída'
    when v_qty_done>0 then 'Parcial' else 'Aguardando' end where id=v_order.id;
 end loop;

 insert into public.nesting_history(nesting_id,event_type,from_status,to_status,note,details)
 values(p_nesting_id,'Concluído','Em produção','Concluído',nullif(btrim(coalesce(p_note,'')),''),
        jsonb_build_object('itens',v_det));
end $$;

create or replace view public.nesting_summary as
select n.id,n.code,n.laser_machine_id,m.name as machine_name,n.material,n.material_code,n.thickness_mm,n.status,
 n.programmed_at,n.notes,n.created_at,n.started_at,n.completed_at,
 coalesce(s.items_count,0::bigint)::integer as items_count,
 coalesce(s.qty_programmed,0::numeric) as qty_programmed,
 coalesce(s.qty_cut,0::numeric) as qty_cut,s.list_ids,s.list_names,n.sheet_material_type
from public.nestings n
left join public.laser_machines m on m.id=n.laser_machine_id
left join lateral (
 select count(*) as items_count,sum(i.quantity_programmed) as qty_programmed,sum(i.quantity_cut) as qty_cut,
  array_agg(distinct o.list_id) filter(where o.list_id is not null) as list_ids,
  string_agg(distinct coalesce(l.code||' - ','')||l.name,', ') as list_names
 from public.nesting_order_items i
 left join public.production_orders o on o.id=i.production_order_id
 left join public.production_lists l on l.id=o.list_id
 where i.nesting_id=n.id
) s on true;

revoke all on function public.save_nesting(uuid,text,uuid,text,text,text,numeric,date,text,jsonb) from public,anon;
grant execute on function public.save_nesting(uuid,text,uuid,text,text,text,numeric,date,text,jsonb) to authenticated;
revoke all on function public.record_nesting_cut(uuid,jsonb) from public,anon;
grant execute on function public.record_nesting_cut(uuid,jsonb) to authenticated;
revoke all on function public.complete_nesting(uuid,jsonb,text) from public,anon;
grant execute on function public.complete_nesting(uuid,jsonb,text) to authenticated;
