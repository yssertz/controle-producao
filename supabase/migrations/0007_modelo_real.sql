-- =====================================================================
-- 0007: MODELO REAL DA FÁBRICA (ajustes após analisar as planilhas)
--   1. Linhas de produção = linhas da planilha de controle (6KW e 40KW separados, 12KW etc.),
--      ligadas aos códigos de linha do ERP (tabela erp_line_codes).
--   2. Cadastro item -> linha (item_line_catalog), importado do ERP/planilha.
--   3. Máquinas de corte: Laser 6KW, Laser 12KW, Laser 40KW e Bobina.
--   4. Um nesting pode conter peças de VÁRIAS listas (cada peça pertence à sua lista).
--   5. Listas ganham código numérico e data de entrega.
--   6. Itens ganham dados da matéria-prima (código, qtde, unidade) e nota fiscal (Leniors).
--   7. Importação no formato do ERP: OP | Qtde | Código | Descrição | Código MP | Qtde MP | Und | Descrição MP
--   8. Leniors: etapas Corte / Dobra / Acabamento por item + nota fiscal.
-- Pode ser executada mais de uma vez.
-- =====================================================================

-- 1. LINHAS -------------------------------------------------------------
insert into public.production_lines (name, sort_order, allows_nesting) values
  ('GEKA', 10, false),
  ('GEKA DOBRA', 20, false),
  ('GEKA USINAGEM', 30, false),
  ('GUILHOTINA', 40, false),
  ('GUILHOTINA DOBRA', 50, false),
  ('GUILHOTINA USINAGEM', 60, false),
  ('GUILHOTINA GEKA', 65, false),
  ('LASER 6KW', 70, true),
  ('LASER 6KW DOBRA', 80, true),
  ('LASER 6KW USINAGEM', 90, true),
  ('LASER 6KW USINAGEM DOBRA', 95, true),
  ('LASER 6KW GEKA', 97, true),
  ('LASER 40KW', 100, true),
  ('LASER 40KW USINAGEM', 110, true),
  ('LASER 12KW', 120, true),
  ('SERRA', 130, false),
  ('SERRA USINAGEM', 140, false),
  ('SERRA DOBRA', 150, false),
  ('ROBÔ CALFRAN', 160, false),
  ('USINAGEM', 170, false)
on conflict do nothing;

-- As 3 linhas de laser antigas (nomes combinados antes das planilhas) ficam inativas:
-- não somem, itens antigos continuam válidos. As demais (GEKA, GUILHOTINA, SERRA, USINAGEM e variantes) permanecem.
update public.production_lines set active = false
 where name in ('LASER 6KW/40KW', 'LASER 6KW/40KW DOBRA', 'LASER 6KW/40KW USINAGEM');

-- Código de linha do ERP -> linha do sistema (line_id nulo = linha do ERP que não é controlada aqui)
create table if not exists public.erp_line_codes (
  code        integer primary key,
  description text not null,
  line_id     uuid references public.production_lines(id) on delete set null
);

insert into public.erp_line_codes (code, description, line_id)
select v.code, v.descr, l.id
  from (values
  (200, 'ROD. PEÇAS GABARITO', null),
  (201, 'ROD. MONTAGEM GABARITO', null),
  (202, 'ROD. COMPONENTES EIXO', null),
  (204, 'ROD. OBSOLETOS', null),
  (300, 'AMBIENTAL COMPONENTES MONTAGEM', null),
  (310, 'ROD. GEKA', 'GEKA'),
  (311, 'ROD. GEKA/DOBRA', 'GEKA DOBRA'),
  (312, 'ROD. GEKA/USINAGEM', 'GEKA USINAGEM'),
  (320, 'ROD. GUILHOTINA', 'GUILHOTINA'),
  (321, 'ROD. GUILHOTINA/DOBRA', 'GUILHOTINA DOBRA'),
  (322, 'ROD. GUILHOTINA/USINAGEM', 'GUILHOTINA USINAGEM'),
  (323, 'ROD. GUILHOTINA/GEKA', 'GUILHOTINA GEKA'),
  (330, 'ROD - LASER 6,6 KW', 'LASER 6KW'),
  (331, 'ROD - LASER 6,6 KW/DOBRA', 'LASER 6KW DOBRA'),
  (332, 'ROD - LASER 6,6 KW/USINAGEM', 'LASER 6KW USINAGEM'),
  (333, 'ROD - LASER 6,6 KW/USINAGEM/DO', 'LASER 6KW USINAGEM DOBRA'),
  (334, 'ROD - LASER 6,6 KW/USINAGEM', 'LASER 6KW USINAGEM'),
  (340, 'AMB - LASER DESB./ESTAMPAGEM', null),
  (341, 'AMB - LASER DESB./DOBRA', null),
  (350, 'ROD - LASER 40K', 'LASER 40KW'),
  (351, 'ROD - LASER 40 K/USINAGEM', 'LASER 40KW USINAGEM'),
  (352, 'ROD - LASER 12K', 'LASER 12KW'),
  (360, 'ROD. SERRA', 'SERRA'),
  (361, 'ROD. SERRA/USINAGEM', 'SERRA USINAGEM'),
  (362, 'ROD. SERRA/DOBRA', 'SERRA DOBRA'),
  (363, 'ROD. ROBO/CALFRAN VIGA', 'ROBÔ CALFRAN'),
  (370, 'ROD. USINAGEM', 'USINAGEM'),
  (371, 'ROD. IMPRESSORA 3D', null),
  (380, 'ROD. MONTAGEM EXPEDICAO', null),
  (390, 'ROD.TUBULACAO HIDRAULICA', null),
  (391, 'ROD. DOBRADEIRA TUBO', null),
  (400, 'ROD. CONTEINER', null),
  (410, 'ROD. PLATAFORMA', null),
  (412, 'ROD. PEÇAS MONTAGEM', null),
  (420, 'ROD. PLATAFORMA BOIADEIRA', null),
  (430, 'ROD. ROLL ON SB/SBL', null),
  (431, 'ROD. TELESCOPIO STB/STBL', null),
  (432, 'ROD. POLI POSTIÇO', null),
  (440, 'ROD. CARRETA AGRICOLA', null),
  (450, 'ROD. REBOQUE', null),
  (451, 'ROD. REBOQUE BASC.', null),
  (452, 'AMBIENTAL BENEFICIAMENTO', null),
  (460, 'AMBIENTAL CONTENTOR', null),
  (461, 'AMBIENTAL COLETOR', null),
  (462, 'AMBIENTAL AUTOMACAO COLETOR', null),
  (470, 'ROD. EIXOS E SUSPENSAO', null)
  ) as v(code, descr, line_name)
  left join public.production_lines l on lower(l.name) = lower(v.line_name)
on conflict (code) do nothing;

-- 2. CATÁLOGO ITEM -> LINHA -----------------------------------------------
create table if not exists public.item_line_catalog (
  item_code      text primary key check (item_code = upper(btrim(item_code)) and item_code <> ''),
  erp_line_code  integer,
  description    text,
  updated_at     timestamptz not null default now()
);
create index if not exists item_line_catalog_line_idx on public.item_line_catalog (erp_line_code);

-- 3. MÁQUINAS DE CORTE ----------------------------------------------------
insert into public.laser_machines (name, sort_order) values ('Laser 12KW', 15), ('Bobina', 30) on conflict do nothing;

-- 5. LISTAS -----------------------------------------------------------------
alter table public.production_lists
  add column if not exists code text,
  add column if not exists delivery_date date;

-- 6. ITENS: matéria-prima e nota fiscal --------------------------------------
alter table public.production_orders
  add column if not exists material_code text,
  add column if not exists material_qty numeric(16,4),
  add column if not exists material_unit text,
  add column if not exists invoice_number text;

-- 4. NESTING COM VÁRIAS LISTAS -----------------------------------------------
alter table public.nestings drop constraint if exists nestings_list_required_ck;
comment on column public.nestings.list_id is 'LEGADO. A lista agora é a de cada item (production_orders.list_id).';

-- Guarda dos vínculos (igual à 0002, SEM a regra de "mesma lista")
create or replace function public.cgp_noi_guard()
returns trigger language plpgsql as $$
declare
  v_n public.nestings;
  v_o public.production_orders;
  v_alloc numeric;
begin
  if tg_op = 'DELETE' then
    select * into v_n from public.nestings where id = old.nesting_id;
    if found and v_n.status <> 'Programado' then
      raise exception 'Só é possível remover OPs de um nesting Programado (o nesting % está %).', v_n.code, v_n.status;
    end if;
    return old;
  end if;

  select * into v_n from public.nestings where id = new.nesting_id;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;

  select * into v_o from public.production_orders where id = new.production_order_id for update;
  if not found then
    raise exception 'Item de produção não encontrado.';
  end if;

  if tg_op = 'INSERT' then
    if v_n.status <> 'Programado' then
      raise exception 'Só é possível vincular OPs a um nesting Programado (o nesting % está %).', v_n.code, v_n.status;
    end if;
    if v_o.archived_at is not null then
      raise exception 'O item da OP % está arquivado.', v_o.op_number;
    end if;
    if new.quantity_cut <> 0 then
      raise exception 'Um nesting Programado não pode ter quantidade cortada.';
    end if;
  else
    if new.nesting_id <> old.nesting_id or new.production_order_id <> old.production_order_id then
      raise exception 'Não é permitido trocar o nesting ou a OP de um vínculo existente.';
    end if;
    if (new.quantity_programmed <> old.quantity_programmed or new.allow_excess <> old.allow_excess)
       and v_n.status <> 'Programado' then
      raise exception 'A quantidade programada só pode ser alterada em nesting Programado (o nesting % está %).', v_n.code, v_n.status;
    end if;
    if new.quantity_cut <> old.quantity_cut and v_n.status <> 'Em produção' then
      raise exception 'A quantidade cortada só pode ser registrada em nesting Em produção (o nesting % está %).', v_n.code, v_n.status;
    end if;
  end if;

  if new.quantity_cut < 0 then
    raise exception 'A quantidade cortada não pode ser negativa.';
  end if;
  if new.quantity_cut > new.quantity_programmed then
    raise exception 'A quantidade cortada (%) da OP % não pode ultrapassar a programada (%).',
      public.cgp_fmt_qty(new.quantity_cut), v_o.op_number, public.cgp_fmt_qty(new.quantity_programmed);
  end if;

  if tg_op = 'INSERT'
     or new.quantity_programmed <> old.quantity_programmed
     or new.allow_excess <> old.allow_excess then
    v_alloc := public.cgp_item_allocated(new.production_order_id, new.nesting_id);
    if v_alloc + new.quantity_programmed > v_o.quantity and not new.allow_excess then
      raise exception using
        errcode = 'CG001',
        message = format(
          'EXCESSO: a OP %s (%s) precisa de %s, já há %s em outros nestings e este nesting pede %s (total %s). Confirme explicitamente para programar excedente.',
          v_o.op_number, coalesce(v_o.item_code, v_o.description, 'sem código'),
          public.cgp_fmt_qty(v_o.quantity), public.cgp_fmt_qty(v_alloc),
          public.cgp_fmt_qty(new.quantity_programmed), public.cgp_fmt_qty(v_alloc + new.quantity_programmed));
    end if;
  end if;

  return new;
end $$;

-- save_nesting sem lista única
drop function if exists public.save_nesting(uuid, text, uuid, uuid, text, numeric, date, text, jsonb);

create or replace function public.save_nesting(
  p_nesting_id uuid,
  p_code text,
  p_laser_machine_id uuid,
  p_material text,
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
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cadastrar nestings.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'Informe o código do nesting.';
  end if;
  if p_laser_machine_id is null then
    raise exception 'Selecione a máquina de corte.';
  end if;
  if not exists (select 1 from public.laser_machines where id = p_laser_machine_id and active) then
    raise exception 'Máquina inválida ou inativa.';
  end if;
  if p_thickness_mm is not null and p_thickness_mm < 0 then
    raise exception 'A espessura não pode ser negativa.';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Envie as OPs como uma lista.';
  end if;

  select array_agg((e ->> 'production_order_id')::uuid) into v_ids from jsonb_array_elements(v_items) e;
  if v_ids is not null and (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception 'Há OPs repetidas na lista do nesting.';
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_qty := nullif(btrim(coalesce(v_item ->> 'quantity_programmed', '')), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'A quantidade programada de cada OP deve ser maior que zero.';
    end if;
  end loop;

  if p_nesting_id is null then
    insert into public.nestings (code, laser_machine_id, material, thickness_mm, programmed_at, notes)
    values (btrim(p_code), p_laser_machine_id, nullif(btrim(coalesce(p_material, '')), ''),
            p_thickness_mm, p_programmed_at, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;

    insert into public.nesting_history (nesting_id, event_type, to_status, details)
    values (v_id, 'Criado', 'Programado', jsonb_build_object('itens', jsonb_array_length(v_items)));
  else
    select * into v_n from public.nestings where id = p_nesting_id for update;
    if not found then
      raise exception 'Nesting não encontrado.';
    end if;
    if v_n.status <> 'Programado' then
      raise exception 'Só é possível editar nestings Programados (este está %).', v_n.status;
    end if;
    v_id := p_nesting_id;

    delete from public.nesting_order_items
     where nesting_id = v_id and (v_ids is null or production_order_id <> all (v_ids));

    update public.nestings
       set code = btrim(p_code),
           laser_machine_id = p_laser_machine_id,
           material = nullif(btrim(coalesce(p_material, '')), ''),
           thickness_mm = p_thickness_mm,
           programmed_at = p_programmed_at,
           notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = v_id;

    insert into public.nesting_history (nesting_id, event_type, from_status, to_status, details)
    values (v_id, 'Editado', 'Programado', 'Programado', jsonb_build_object('itens', jsonb_array_length(v_items)));
  end if;

  for v_item in
    select value from jsonb_array_elements(v_items) order by (value ->> 'production_order_id')
  loop
    insert into public.nesting_order_items (nesting_id, production_order_id, quantity_programmed, notes, allow_excess)
    values (
      v_id,
      (v_item ->> 'production_order_id')::uuid,
      (v_item ->> 'quantity_programmed')::numeric,
      nullif(btrim(coalesce(v_item ->> 'notes', '')), ''),
      coalesce((v_item ->> 'allow_excess')::boolean, false)
    )
    on conflict (nesting_id, production_order_id) do update
      set quantity_programmed = excluded.quantity_programmed,
          notes = excluded.notes,
          allow_excess = excluded.allow_excess;
  end loop;

  return v_id;
end $$;

-- 7. IMPORTAÇÃO NO FORMATO DO ERP --------------------------------------------
drop function if exists public.import_production_items(uuid, uuid, jsonb, boolean);

-- Resolve a linha de cada código de item (usado na prévia da colagem)
create or replace function public.resolve_item_lines(p_codes jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', c.item_code, 'erp_line_code', c.erp_line_code,
           'line_id', e.line_id, 'line_name', l.name)), '[]'::jsonb)
    from public.item_line_catalog c
    left join public.erp_line_codes e on e.code = c.erp_line_code
    left join public.production_lines l on l.id = e.line_id
   where c.item_code in (select upper(btrim(x)) from jsonb_array_elements_text(p_codes) x);
$$;

-- Importa itens. A LINHA vem do catálogo (item -> linha ERP -> linha do sistema).
-- Sem linha no catálogo: usa p_default_line_id; se não houver, a linha é IGNORADA (não é erro).
-- Duplicidade: mesma lista + mesma linha + mesma OP + mesmo Código + mesmo Código MP.
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

      if v_op is null then raise exception 'OP é obrigatória.'; end if;
      if v_item is null then raise exception 'Código do item é obrigatório.'; end if;
      if v_qty is null or v_qty <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;

      select e.line_id into v_line
        from public.item_line_catalog c
        join public.erp_line_codes e on e.code = c.erp_line_code
        join public.production_lines pl on pl.id = e.line_id and pl.active
       where c.item_code = upper(v_item);
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
        (list_id, production_line_id, op_number, item_code, description, quantity,
         material, material_code, material_qty, material_unit)
      values
        (p_list_id, v_line, v_op, v_item, v_desc, v_qty, v_mdesc, v_mcode, v_mqty, v_munit);
      v_inserted := v_inserted + 1;

    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_dups, 'duplicate_rows', v_dup_rows,
    'no_line', v_noline, 'errors', v_errors);
end $$;

-- Importa/atualiza o catálogo item -> linha ERP
create or replace function public.import_item_catalog(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_unknown jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para importar o catálogo.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Envie as linhas como uma lista.';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Envie no máximo 5000 linhas por chamada.';
  end if;

  insert into public.item_line_catalog (item_code, erp_line_code, description)
  select distinct on (upper(btrim(t.e ->> 'item_code')))
         upper(btrim(t.e ->> 'item_code')),
         nullif(btrim(coalesce(t.e ->> 'erp_line_code', '')), '')::integer,
         nullif(btrim(coalesce(t.e ->> 'description', '')), '')
    from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
   where nullif(btrim(coalesce(t.e ->> 'item_code', '')), '') is not null
   order by upper(btrim(t.e ->> 'item_code')), t.ord desc
  on conflict (item_code) do update
    set erp_line_code = excluded.erp_line_code,
        description = excluded.description,
        updated_at = now();
  get diagnostics v_n = row_count;

  select coalesce(jsonb_agg(distinct c), '[]'::jsonb) into v_unknown
    from (select nullif(btrim(coalesce(e ->> 'erp_line_code', '')), '')::integer as c
            from jsonb_array_elements(p_rows) e) x
   where c is not null and not exists (select 1 from public.erp_line_codes k where k.code = x.c);

  return jsonb_build_object('processed', v_n, 'unknown_line_codes', v_unknown);
end $$;

-- 8. LENIORS: etapas e nota fiscal --------------------------------------------
alter table public.production_order_steps drop constraint if exists production_order_steps_status_check;
alter table public.production_order_steps
  add constraint production_order_steps_status_check
  check (status in ('Aguardando','Em produção','Parcial','Concluída','Bloqueada','Terceirizado','Não se aplica'));

-- Etapas do Leniors: 1 = Corte (setor Laser), 2 = Dobra, 3 = Acabamento.
-- Estados: Aguardando | Concluída | Não se aplica. A OP está FINALIZADA quando as 3 etapas
-- estão Concluída ou Não se aplica (o item passa a "Concluída").
create or replace function public.set_leniors_step(p_item_id uuid, p_step integer, p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric;
  v_sector uuid;
  v_type text;
  v_done integer;
  v_any integer;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para registrar etapas.' using errcode = '42501';
  end if;
  if p_step not in (1, 2, 3) then
    raise exception 'Etapa inválida.';
  end if;
  if p_state not in ('Aguardando', 'Concluída', 'Não se aplica') then
    raise exception 'Estado inválido.';
  end if;

  select o.quantity, l.list_type into v_qty, v_type
    from public.production_orders o
    join public.production_lists l on l.id = o.list_id
   where o.id = p_item_id for update of o;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  if v_type <> 'Leniors' then
    raise exception 'Etapas Corte/Dobra/Acabamento são usadas apenas em listas Leniors.';
  end if;

  select id into v_sector from public.production_sectors
   where name = case p_step when 1 then 'Laser' when 2 then 'Dobra' else 'Acabamento' end;
  if v_sector is null then
    raise exception 'Setor da etapa não encontrado. Execute a migração 0001.';
  end if;

  insert into public.production_order_steps
    (production_order_id, sector_id, step_order, status, quantity_completed, completed_at)
  values
    (p_item_id, v_sector, p_step, p_state,
     case when p_state = 'Concluída' then v_qty else 0 end,
     case when p_state = 'Concluída' then now() else null end)
  on conflict (production_order_id, step_order) do update
    set status = excluded.status,
        quantity_completed = excluded.quantity_completed,
        completed_at = excluded.completed_at;

  select count(*) filter (where status in ('Concluída', 'Não se aplica')),
         count(*) filter (where status = 'Concluída')
    into v_done, v_any
    from public.production_order_steps where production_order_id = p_item_id and step_order in (1, 2, 3);

  update public.production_orders
     set status = case when v_done = 3 then 'Concluída' when v_any > 0 then 'Em produção' else 'Aguardando' end
   where id = p_item_id;
end $$;

create or replace function public.set_item_invoice(p_item_ids uuid[], p_invoice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para registrar a nota fiscal.' using errcode = '42501';
  end if;
  update public.production_orders
     set invoice_number = nullif(btrim(coalesce(p_invoice, '')), '')
   where id = any (p_item_ids);
end $$;

-- 9. VIEWS ------------------------------------------------------------------
drop view if exists public.production_item_balance;
create view public.production_item_balance
with (security_invoker = true) as
select
  o.id, o.list_id, l.name as list_name, l.code as list_code, l.list_type, l.delivery_date as list_delivery_date,
  o.production_line_id, pl.name as line_name, pl.allows_nesting as line_allows_nesting,
  o.op_number, o.item_code, o.description, o.unit, o.equipment_name,
  o.material, o.material_code, o.material_qty, o.material_unit, o.thickness_mm,
  o.due_date, o.status, o.notes, o.invoice_number, o.archived_at, o.created_at, o.updated_at,
  o.quantity as qty_total,
  coalesce(a.qty_programmed, 0) as qty_programmed,
  coalesce(a.qty_cut, 0) as qty_cut,
  greatest(o.quantity - coalesce(a.qty_programmed, 0), 0) as qty_unscheduled,
  greatest(o.quantity - coalesce(a.qty_cut, 0), 0) as qty_pending_cut,
  greatest(coalesce(a.qty_programmed, 0) - o.quantity, 0) as qty_excess_programmed,
  greatest(coalesce(a.qty_cut, 0) - o.quantity, 0) as qty_excess_cut
from public.production_orders o
left join public.production_lists l on l.id = o.list_id
left join public.production_lines pl on pl.id = o.production_line_id
left join lateral (
  select
    sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end) as qty_programmed,
    sum(case when n.status in ('Em produção', 'Concluído') then i.quantity_cut else 0 end) as qty_cut
  from public.nesting_order_items i
  join public.nestings n on n.id = i.nesting_id
  where i.production_order_id = o.id and n.status in ('Programado', 'Em produção', 'Concluído')
) a on true;

drop view if exists public.nesting_summary;
create view public.nesting_summary
with (security_invoker = true) as
select
  n.id, n.code, n.laser_machine_id, m.name as machine_name, n.material, n.thickness_mm,
  n.status, n.programmed_at, n.notes, n.created_at, n.started_at, n.completed_at,
  coalesce(s.items_count, 0)::integer as items_count,
  coalesce(s.qty_programmed, 0) as qty_programmed,
  coalesce(s.qty_cut, 0) as qty_cut,
  s.list_ids,
  s.list_names
from public.nestings n
left join public.laser_machines m on m.id = n.laser_machine_id
left join lateral (
  select count(*) as items_count,
         sum(i.quantity_programmed) as qty_programmed,
         sum(i.quantity_cut) as qty_cut,
         array_agg(distinct o.list_id) filter (where o.list_id is not null) as list_ids,
         string_agg(distinct coalesce(l.code || ' - ', '') || l.name, ', ') as list_names
    from public.nesting_order_items i
    join public.production_orders o on o.id = i.production_order_id
    left join public.production_lists l on l.id = o.list_id
   where i.nesting_id = n.id
) s on true;

drop view if exists public.production_list_summary;
create view public.production_list_summary
with (security_invoker = true) as
select
  l.id, l.code, l.name, l.list_type, l.reference_date, l.delivery_date, l.status, l.notes, l.created_at, l.updated_at,
  (select count(*) from public.production_orders o where o.list_id = l.id and o.archived_at is null)::integer as items_count,
  (select coalesce(sum(o.quantity), 0) from public.production_orders o where o.list_id = l.id and o.archived_at is null) as qty_total,
  (select count(distinct n.id) from public.nesting_order_items i
     join public.production_orders o on o.id = i.production_order_id
     join public.nestings n on n.id = i.nesting_id
    where o.list_id = l.id and n.status <> 'Cancelado')::integer as nestings_count
from public.production_lists l;

-- 10. DASHBOARD (lista agora é a dos itens do nesting) --------------------------
create or replace function public.dashboard_summary(
  p_from date default null,
  p_to date default null,
  p_list_id uuid default null,
  p_line_id uuid default null,
  p_item_status text default null,
  p_nesting_status text default null,
  p_machine_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_lists integer;
  v_items jsonb;
  v_nest jsonb;
  v_by_line jsonb;
  v_by_machine jsonb;
begin
  -- Listas (não arquivadas)
  select count(*) into v_lists
    from public.production_lists l
   where l.status <> 'Arquivada'
     and (p_list_id is null or l.id = p_list_id)
     and (p_from is null or (l.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
     and (p_to   is null or (l.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
     and (p_line_id is null or exists (
            select 1 from public.production_orders o
             where o.list_id = l.id and o.production_line_id = p_line_id and o.archived_at is null));

  -- Itens (não arquivados)
  select jsonb_build_object(
    'total',         count(*),
    'open',          count(*) filter (where o.status <> 'Concluída'),
    'waiting',       count(*) filter (where o.status = 'Aguardando'),
    'in_production', count(*) filter (where o.status = 'Em produção'),
    'partial',       count(*) filter (where o.status = 'Parcial'),
    'done',          count(*) filter (where o.status = 'Concluída'),
    'blocked',       count(*) filter (where o.status = 'Bloqueada'),
    'ops_open',      count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status <> 'Concluída'),
    'ops_waiting',   count(distinct (o.list_id::text || '|' || o.op_number)) filter (where o.status = 'Aguardando')
  ) into v_items
  from public.production_orders o
  where o.archived_at is null
    and (p_list_id is null or o.list_id = p_list_id)
    and (p_line_id is null or o.production_line_id = p_line_id)
    and (p_item_status is null or o.status = p_item_status)
    and (p_from is null or (o.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
    and (p_to   is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to);

  -- Nestings
  with ns as (
    select n.*
      from public.nestings n
     where (p_list_id is null or exists (
              select 1 from public.nesting_order_items il
                join public.production_orders ol on ol.id = il.production_order_id
               where il.nesting_id = n.id and ol.list_id = p_list_id))
       and (p_machine_id is null or n.laser_machine_id = p_machine_id)
       and (p_line_id is null or exists (
              select 1 from public.nesting_order_items i
                join public.production_orders o on o.id = i.production_order_id
               where i.nesting_id = n.id and o.production_line_id = p_line_id))
  ),
  per as (
    select * from ns
     where (p_nesting_status is null or status = p_nesting_status)
       and (p_from is null or (created_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to   is null or (created_at at time zone 'America/Sao_Paulo')::date <= p_to)
  ),
  done as (
    select * from ns
     where status = 'Concluído'
       and (p_nesting_status is null or p_nesting_status = 'Concluído')
       and (p_from is null or (completed_at at time zone 'America/Sao_Paulo')::date >= p_from)
       and (p_to   is null or (completed_at at time zone 'America/Sao_Paulo')::date <= p_to)
  ),
  pieces as (
    select
      coalesce(sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end)
               filter (where n.status in ('Programado', 'Em produção', 'Concluído')), 0) as programmed,
      coalesce(sum(i.quantity_cut) filter (where n.status in ('Em produção', 'Concluído')), 0) as cut
    from per n
    join public.nesting_order_items i on i.nesting_id = n.id
    join public.production_orders o on o.id = i.production_order_id
    where (p_line_id is null or o.production_line_id = p_line_id)
      and (p_list_id is null or o.list_id = p_list_id)
  )
  select jsonb_build_object(
    'programmed',        (select count(*) from per where status = 'Programado'),
    'in_production',     (select count(*) from per where status = 'Em produção'),
    'done_period',       (select count(*) from done),
    'cancelled',         (select count(*) from per where status = 'Cancelado'),
    'pieces_programmed', (select programmed from pieces),
    'pieces_cut',        (select cut from pieces)
  ) into v_nest;

  -- Itens por linha
  select coalesce(jsonb_agg(jsonb_build_object('line', pl.name, 'total', x.total, 'done', x.done)
                            order by pl.sort_order), '[]'::jsonb)
    into v_by_line
    from public.production_lines pl
    join lateral (
      select count(*) as total, count(*) filter (where o.status = 'Concluída') as done
        from public.production_orders o
       where o.production_line_id = pl.id and o.archived_at is null
         and (p_list_id is null or o.list_id = p_list_id)
         and (p_item_status is null or o.status = p_item_status)
         and (p_from is null or (o.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
         and (p_to   is null or (o.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
    ) x on true
   where x.total > 0
     and (p_line_id is null or pl.id = p_line_id);

  -- Nestings por máquina
  select coalesce(jsonb_agg(jsonb_build_object(
           'machine', m.name,
           'programmed', y.programmed, 'in_production', y.in_production, 'done', y.done,
           'pieces_programmed', y.pieces_programmed, 'pieces_cut', y.pieces_cut)
           order by m.sort_order), '[]'::jsonb)
    into v_by_machine
    from public.laser_machines m
    join lateral (
      select
        count(*) filter (where n.status = 'Programado') as programmed,
        count(*) filter (where n.status = 'Em produção') as in_production,
        count(*) filter (where n.status = 'Concluído') as done,
        coalesce(sum(s.prog), 0) as pieces_programmed,
        coalesce(sum(s.cut), 0) as pieces_cut
      from public.nestings n
      left join lateral (
        select
          sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end) as prog,
          sum(case when n.status in ('Em produção', 'Concluído') then i.quantity_cut else 0 end) as cut
        from public.nesting_order_items i
        join public.production_orders o on o.id = i.production_order_id
        where i.nesting_id = n.id
          and (p_line_id is null or o.production_line_id = p_line_id)
          and (p_list_id is null or o.list_id = p_list_id)
      ) s on n.status <> 'Cancelado'
      where n.laser_machine_id = m.id
        and (p_list_id is null or exists (
               select 1 from public.nesting_order_items il
                 join public.production_orders ol on ol.id = il.production_order_id
                where il.nesting_id = n.id and ol.list_id = p_list_id))
        and (p_nesting_status is null or n.status = p_nesting_status)
        and (p_from is null or (n.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
        and (p_to   is null or (n.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
        and (p_line_id is null or exists (
               select 1 from public.nesting_order_items i2
                 join public.production_orders o2 on o2.id = i2.production_order_id
                where i2.nesting_id = n.id and o2.production_line_id = p_line_id))
    ) y on true
   where (p_machine_id is null or m.id = p_machine_id);

  return jsonb_build_object(
    'lists_total', v_lists,
    'items', v_items,
    'nestings', v_nest,
    'items_by_line', v_by_line,
    'nestings_by_machine', v_by_machine
  );
end $$;

-- 11. SEGURANÇA DAS NOVAS TABELAS E FUNÇÕES ------------------------------------
alter table public.erp_line_codes enable row level security;
alter table public.item_line_catalog enable row level security;
drop policy if exists "cgp_select" on public.erp_line_codes;
drop policy if exists "cgp_insert" on public.erp_line_codes;
drop policy if exists "cgp_update" on public.erp_line_codes;
create policy "cgp_select" on public.erp_line_codes for select to authenticated using (public.cgp_can_read());
create policy "cgp_insert" on public.erp_line_codes for insert to authenticated with check (public.cgp_is_admin());
create policy "cgp_update" on public.erp_line_codes for update to authenticated using (public.cgp_is_admin()) with check (public.cgp_is_admin());
drop policy if exists "cgp_select" on public.item_line_catalog;
create policy "cgp_select" on public.item_line_catalog for select to authenticated using (public.cgp_can_read());
-- item_line_catalog: escrita somente pela função import_item_catalog

revoke all on public.erp_line_codes from anon;
revoke all on public.item_line_catalog from anon;
revoke all on public.production_item_balance from anon;
revoke all on public.nesting_summary from anon;
revoke all on public.production_list_summary from anon;
grant select on public.production_item_balance to authenticated;
grant select on public.nesting_summary to authenticated;
grant select on public.production_list_summary to authenticated;

revoke all on function public.save_nesting(uuid, text, uuid, text, numeric, date, text, jsonb) from public, anon;
revoke all on function public.resolve_item_lines(jsonb) from public, anon;
revoke all on function public.import_items_erp(uuid, jsonb, uuid, boolean) from public, anon;
revoke all on function public.import_item_catalog(jsonb) from public, anon;
revoke all on function public.set_leniors_step(uuid, integer, text) from public, anon;
revoke all on function public.set_item_invoice(uuid[], text) from public, anon;
revoke all on function public.dashboard_summary(date, date, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.save_nesting(uuid, text, uuid, text, numeric, date, text, jsonb) to authenticated;
grant execute on function public.resolve_item_lines(jsonb) to authenticated;
grant execute on function public.import_items_erp(uuid, jsonb, uuid, boolean) to authenticated;
grant execute on function public.import_item_catalog(jsonb) to authenticated;
grant execute on function public.set_leniors_step(uuid, integer, text) to authenticated;
grant execute on function public.set_item_invoice(uuid[], text) to authenticated;
grant execute on function public.dashboard_summary(date, date, uuid, uuid, text, text, uuid) to authenticated;
