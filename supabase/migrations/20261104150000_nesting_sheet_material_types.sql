alter table public.nestings add column if not exists sheet_material_type text;
alter table public.nestings drop constraint if exists nestings_sheet_material_type_check;
alter table public.nestings add constraint nestings_sheet_material_type_check
 check (sheet_material_type is null or sheet_material_type in ('A36_SAE1010_20_NORMAL','A36_SAE1010_20_LNE','GALVANIZADA','INOX','HARDOX','STRENX'));
drop function if exists public.save_nesting(text,jsonb,uuid,text,uuid,text,date,numeric);
drop function if exists public.save_nesting(uuid,text,uuid,text,text,numeric,date,text,jsonb);

create or replace function public.cgp_classify_sheet_material(p_material text)
returns text language plpgsql immutable set search_path=public as $$
declare v text := upper(coalesce(p_material,''));
begin
 if v='' then return null; end if;
 if v ~ '(^|[^A-Z0-9])LNE([^A-Z0-9]|$)|LNE[- ]?[0-9]' then return 'A36_SAE1010_20_LNE'; end if;
 if v ~ 'ASTM[ -]*A[ -]*36|SAE[[:space:]]*1010[[:space:]]*/[[:space:]]*20' then return 'A36_SAE1010_20_NORMAL'; end if;
 if v like '%GALVANIZ%' then return 'GALVANIZADA'; end if;
 if v like '%INOX%' or v ~ 'AISI[[:space:]]*30[24]' then return 'INOX'; end if;
 if v like '%HARDOX%' then return 'HARDOX'; end if;
 if v like '%STRENX%' then return 'STRENX'; end if;
 return null;
end $$;

create or replace function public.save_nesting(
 p_nesting_id uuid,p_code text,p_laser_machine_id uuid,p_material text,p_material_code text,
 p_sheet_material_type text,p_thickness_mm numeric,p_programmed_at date,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_n public.nestings; v_item jsonb; v_qty numeric; v_ids uuid[];
 v_items jsonb:=coalesce(p_items,'[]'::jsonb); v_o public.production_orders; v_item_type text; v_first boolean:=true;
begin
 if not public.cgp_can_plan() then raise exception 'Você não tem permissão para cadastrar nestings.' using errcode='42501'; end if;
 if btrim(coalesce(p_code,''))='' then raise exception 'Informe o código do nesting.'; end if;
 if p_laser_machine_id is null then raise exception 'Selecione a máquina de corte.'; end if;
 if not exists(select 1 from public.laser_machines where id=p_laser_machine_id and active) then raise exception 'Máquina inválida ou inativa.'; end if;
 if p_sheet_material_type is null or p_sheet_material_type not in ('A36_SAE1010_20_NORMAL','A36_SAE1010_20_LNE','GALVANIZADA','INOX','HARDOX','STRENX') then raise exception 'Selecione um tipo de chapa válido.'; end if;
 if p_thickness_mm is not null and p_thickness_mm<0 then raise exception 'A espessura não pode ser negativa.'; end if;
 if jsonb_typeof(v_items)<>'array' then raise exception 'Envie as OPs como uma lista.'; end if;
 select array_agg((e->>'production_order_id')::uuid) into v_ids from jsonb_array_elements(v_items)e;
 if v_ids is not null and (select count(distinct x) from unnest(v_ids)x)<>array_length(v_ids,1) then raise exception 'Há OPs repetidas na lista do nesting.'; end if;
 for v_item in select value from jsonb_array_elements(v_items) loop
  v_qty:=nullif(btrim(coalesce(v_item->>'quantity_programmed','')),'')::numeric;
  if v_qty is null or v_qty<=0 then raise exception 'A quantidade programada de cada OP deve ser maior que zero.'; end if;
  select * into v_o from public.production_orders where id=(v_item->>'production_order_id')::uuid;
  if not found then raise exception 'Uma das OPs informadas não foi encontrada.'; end if;
  v_item_type:=public.cgp_classify_sheet_material(v_o.material);
  if v_item_type is null then raise exception 'A OP % possui matéria-prima não identificada para nesting (%).',v_o.op_number,coalesce(v_o.material,'sem descrição'); end if;
  if p_sheet_material_type='A36_SAE1010_20_LNE' then
   if v_item_type not in ('A36_SAE1010_20_LNE','A36_SAE1010_20_NORMAL') then raise exception 'A OP % possui material incompatível com a chapa LNE.',v_o.op_number; end if;
  elsif v_item_type<>p_sheet_material_type then raise exception 'A OP % possui material incompatível com o tipo de chapa selecionado.',v_o.op_number;
  end if;
  if v_o.thickness_mm is null then raise exception 'A OP % não possui espessura cadastrada.',v_o.op_number; end if;
  if v_first then
   if p_thickness_mm is not null and p_thickness_mm<>v_o.thickness_mm then raise exception 'A espessura informada no nesting (% mm) não corresponde à OP % (% mm).',p_thickness_mm,v_o.op_number,v_o.thickness_mm; end if;
   p_thickness_mm:=v_o.thickness_mm; v_first:=false;
  elsif v_o.thickness_mm<>p_thickness_mm then raise exception 'Não é possível misturar espessuras no mesmo nesting. A OP % possui % mm e o nesting usa % mm.',v_o.op_number,v_o.thickness_mm,p_thickness_mm;
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
  delete from public.nesting_order_items where nesting_id=v_id and (v_ids is null or production_order_id<>all(v_ids));
  update public.nestings set code=btrim(p_code),laser_machine_id=p_laser_machine_id,material=nullif(btrim(coalesce(p_material,'')),''),
   material_code=nullif(btrim(coalesce(p_material_code,'')),''),sheet_material_type=p_sheet_material_type,thickness_mm=p_thickness_mm,
   programmed_at=p_programmed_at,notes=nullif(btrim(coalesce(p_notes,'')),'') where id=v_id;
  insert into public.nesting_history(nesting_id,event_type,from_status,to_status,details)
  values(v_id,'Editado','Programado','Programado',jsonb_build_object('itens',jsonb_array_length(v_items),'sheet_material_type',p_sheet_material_type,'thickness_mm',p_thickness_mm));
 end if;
 for v_item in select value from jsonb_array_elements(v_items) order by (value->>'production_order_id') loop
  insert into public.nesting_order_items(nesting_id,production_order_id,quantity_programmed,notes,allow_excess)
  values(v_id,(v_item->>'production_order_id')::uuid,(v_item->>'quantity_programmed')::numeric,nullif(btrim(coalesce(v_item->>'notes','')),''),coalesce((v_item->>'allow_excess')::boolean,false))
  on conflict(nesting_id,production_order_id) do update set quantity_programmed=excluded.quantity_programmed,notes=excluded.notes,allow_excess=excluded.allow_excess;
 end loop;
 return v_id;
end $$;

create or replace view public.nesting_summary as
select n.id,n.code,n.laser_machine_id,m.name as machine_name,n.material,n.material_code,n.thickness_mm,n.status,n.programmed_at,n.notes,n.created_at,n.started_at,n.completed_at,
 coalesce(s.items_count,0::bigint)::integer as items_count,coalesce(s.qty_programmed,0::numeric) as qty_programmed,coalesce(s.qty_cut,0::numeric) as qty_cut,s.list_ids,s.list_names,n.sheet_material_type
from public.nestings n left join public.laser_machines m on m.id=n.laser_machine_id
left join lateral (
 select count(*) as items_count,sum(i.quantity_programmed) as qty_programmed,sum(i.quantity_cut) as qty_cut,
 array_agg(distinct o.list_id) filter(where o.list_id is not null) as list_ids,string_agg(distinct coalesce(l.code || ' - ','')||l.name,', ') as list_names
 from public.nesting_order_items i join public.production_orders o on o.id=i.production_order_id
 left join public.production_lists l on l.id=o.list_id where i.nesting_id=n.id
)s on true;
revoke all on function public.save_nesting(uuid,text,uuid,text,text,text,numeric,date,text,jsonb) from public, anon;
grant execute on function public.save_nesting(uuid,text,uuid,text,text,text,numeric,date,text,jsonb) to authenticated;
grant execute on function public.cgp_classify_sheet_material(text) to authenticated;
