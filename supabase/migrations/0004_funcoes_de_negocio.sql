-- =====================================================================
-- 0004: FUNÇÕES DE NEGÓCIO (operações críticas em uma única transação)
--
-- Cada função abaixo roda inteira ou não roda: se qualquer validação falhar,
-- NADA é gravado. O sistema chama estas funções pelo Supabase (supabase.rpc).
--
--   import_production_items  -> importa em lote (colagem do Excel) ignorando duplicados
--   save_nesting             -> cria/edita nesting + OPs vinculadas de uma vez
--   start_nesting            -> Programado   -> Em produção
--   record_nesting_cut       -> registra/corrige quantidades cortadas (Em produção)
--   complete_nesting         -> Em produção  -> Concluído (com conferência por item)
--   cancel_nesting           -> Programado/Em produção (sem corte) -> Cancelado
--   reopen_nesting           -> Concluído    -> Em produção (ação explícita, com motivo)
-- =====================================================================

-- ---------------------------------------------------------------------
-- IMPORTAÇÃO EM LOTE
-- Regra de duplicidade (documentada também no README):
--   mesma LISTA + mesma LINHA + mesma OP + mesmo ITEM (ignorando maiúsculas/espaços).
--   Se o ITEM estiver vazio, a DESCRIÇÃO entra na comparação.
--   Itens arquivados não contam.
-- Roda como o usuário logado (security invoker): o RLS continua valendo.
-- ---------------------------------------------------------------------
create or replace function public.import_production_items(
  p_list_id uuid,
  p_line_id uuid,
  p_rows jsonb,
  p_skip_duplicates boolean default true
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  v_idx integer := 0;
  v_row integer;
  v_op text; v_item text; v_desc text; v_equip text; v_unit text; v_material text; v_notes text;
  v_qty numeric; v_thick numeric; v_due date;
  v_inserted integer := 0;
  v_dups integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_dup_rows jsonb := '[]'::jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cadastrar itens.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Envie as linhas como uma lista.';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma linha para importar.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Importe no máximo 2000 linhas por vez.';
  end if;
  if not exists (select 1 from public.production_lists where id = p_list_id and status <> 'Arquivada') then
    raise exception 'Lista inexistente ou arquivada.';
  end if;
  if not exists (select 1 from public.production_lines where id = p_line_id and active) then
    raise exception 'Linha de produção inexistente ou inativa.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_row := coalesce((r ->> 'row')::integer, v_idx);

    begin
      v_op       := nullif(btrim(coalesce(r ->> 'op_number', '')), '');
      v_item     := nullif(btrim(coalesce(r ->> 'item_code', '')), '');
      v_desc     := nullif(btrim(coalesce(r ->> 'description', '')), '');
      v_equip    := nullif(btrim(coalesce(r ->> 'equipment_name', '')), '');
      v_unit     := coalesce(nullif(btrim(coalesce(r ->> 'unit', '')), ''), 'un');
      v_material := nullif(btrim(coalesce(r ->> 'material', '')), '');
      v_notes    := nullif(btrim(coalesce(r ->> 'notes', '')), '');
      v_qty      := nullif(btrim(coalesce(r ->> 'quantity', '')), '')::numeric;
      v_thick    := nullif(btrim(coalesce(r ->> 'thickness_mm', '')), '')::numeric;
      v_due      := nullif(btrim(coalesce(r ->> 'due_date', '')), '')::date;

      if v_op is null then
        raise exception 'OP é obrigatória.';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Quantidade deve ser maior que zero.';
      end if;
      if v_item is null and v_desc is null then
        raise exception 'Informe o Item ou a Descrição.';
      end if;

      if p_skip_duplicates and exists (
        select 1 from public.production_orders o
         where o.list_id = p_list_id
           and o.production_line_id = p_line_id
           and o.archived_at is null
           and upper(btrim(o.op_number)) = upper(v_op)
           and coalesce(upper(btrim(o.item_code)), '') = coalesce(upper(v_item), '')
           and (v_item is not null
                or coalesce(upper(btrim(o.description)), '') = coalesce(upper(v_desc), ''))
      ) then
        v_dups := v_dups + 1;
        v_dup_rows := v_dup_rows || to_jsonb(v_row);
        continue;
      end if;

      insert into public.production_orders
        (list_id, production_line_id, op_number, item_code, description, quantity, unit,
         equipment_name, material, thickness_mm, due_date, notes)
      values
        (p_list_id, p_line_id, v_op, v_item, v_desc, v_qty, v_unit,
         v_equip, v_material, v_thick, v_due, v_notes);
      v_inserted := v_inserted + 1;

    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_dups,
    'duplicate_rows', v_dup_rows,
    'errors', v_errors
  );
end $$;

-- ---------------------------------------------------------------------
-- SALVAR NESTING (cria ou edita) + OPs vinculadas, de forma atômica
-- p_items: [{ "production_order_id": "...", "quantity_programmed": 10, "notes": "", "allow_excess": false }]
-- ---------------------------------------------------------------------
create or replace function public.save_nesting(
  p_nesting_id uuid,
  p_code text,
  p_list_id uuid,
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
  v_list_changed boolean := false;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cadastrar nestings.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'Informe o código do nesting.';
  end if;
  if p_list_id is null then
    raise exception 'Selecione a lista do nesting.';
  end if;
  if p_laser_machine_id is null then
    raise exception 'Selecione a máquina laser (Laser 6KW ou Laser 40KW).';
  end if;
  if not exists (select 1 from public.laser_machines where id = p_laser_machine_id and active) then
    raise exception 'Máquina laser inválida ou inativa.';
  end if;
  if not exists (select 1 from public.production_lists where id = p_list_id and status <> 'Arquivada') then
    raise exception 'Lista inexistente ou arquivada.';
  end if;
  if p_thickness_mm is not null and p_thickness_mm < 0 then
    raise exception 'A espessura não pode ser negativa.';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Envie as OPs como uma lista.';
  end if;

  -- valida as quantidades e rejeita OP repetida na mesma chamada
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
    insert into public.nestings (code, list_id, laser_machine_id, material, thickness_mm, programmed_at, notes)
    values (btrim(p_code), p_list_id, p_laser_machine_id,
            nullif(btrim(coalesce(p_material, '')), ''), p_thickness_mm, p_programmed_at,
            nullif(btrim(coalesce(p_notes, '')), ''))
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
    v_list_changed := v_n.list_id is distinct from p_list_id;

    -- remove os vínculos que saíram da lista (todos, se a lista mudou)
    if v_list_changed then
      delete from public.nesting_order_items where nesting_id = v_id;
    else
      delete from public.nesting_order_items
       where nesting_id = v_id
         and (v_ids is null or production_order_id <> all (v_ids));
    end if;

    update public.nestings
       set code = btrim(p_code),
           list_id = p_list_id,
           laser_machine_id = p_laser_machine_id,
           material = nullif(btrim(coalesce(p_material, '')), ''),
           thickness_mm = p_thickness_mm,
           programmed_at = p_programmed_at,
           notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = v_id;

    insert into public.nesting_history (nesting_id, event_type, from_status, to_status, details)
    values (v_id, 'Editado', 'Programado', 'Programado',
            jsonb_build_object('itens', jsonb_array_length(v_items), 'lista_alterada', v_list_changed));
  end if;

  -- grava os vínculos em ordem fixa (evita travamentos entre duas pessoas ao mesmo tempo)
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

-- ---------------------------------------------------------------------
-- INICIAR CORTE
-- ---------------------------------------------------------------------
create or replace function public.start_nesting(p_nesting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para iniciar o corte.' using errcode = '42501';
  end if;
  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  if v_n.status <> 'Programado' then
    raise exception 'Só é possível iniciar um nesting Programado (este está %).', v_n.status;
  end if;
  if not exists (select 1 from public.nesting_order_items where nesting_id = p_nesting_id) then
    raise exception 'Vincule ao menos uma OP ao nesting antes de iniciar o corte.';
  end if;

  perform set_config('cgp.transicao', 'on', true);
  update public.nestings set status = 'Em produção', started_at = now() where id = p_nesting_id;
  perform set_config('cgp.transicao', 'off', true);

  insert into public.nesting_history (nesting_id, event_type, from_status, to_status)
  values (p_nesting_id, 'Iniciado', 'Programado', 'Em produção');
end $$;

-- ---------------------------------------------------------------------
-- REGISTRAR / CORRIGIR QUANTIDADES CORTADAS (nesting Em produção)
-- p_items: [{ "production_order_id": "...", "quantity_cut": 8 }]  (só os itens enviados mudam)
-- ---------------------------------------------------------------------
create or replace function public.record_nesting_cut(p_nesting_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_item public.nesting_order_items;
  r jsonb;
  v_cut numeric;
  v_op text;
  v_det jsonb := '[]'::jsonb;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para registrar quantidades.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nenhuma quantidade informada.';
  end if;
  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  if v_n.status <> 'Em produção' then
    raise exception 'Só é possível registrar quantidades em um nesting Em produção (este está %).', v_n.status;
  end if;

  for r in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.nesting_order_items
     where nesting_id = p_nesting_id and production_order_id = (r ->> 'production_order_id')::uuid
     for update;
    if not found then
      raise exception 'Um dos itens informados não pertence a este nesting.';
    end if;
    select op_number into v_op from public.production_orders where id = v_item.production_order_id;

    v_cut := nullif(btrim(coalesce(r ->> 'quantity_cut', '')), '')::numeric;
    if v_cut is null or v_cut < 0 then
      raise exception 'Informe uma quantidade cortada válida (zero ou mais) para a OP %.', v_op;
    end if;
    if v_cut > v_item.quantity_programmed then
      raise exception 'A quantidade cortada (%) da OP % não pode ultrapassar a programada (%).',
        public.cgp_fmt_qty(v_cut), v_op, public.cgp_fmt_qty(v_item.quantity_programmed);
    end if;

    if v_cut <> v_item.quantity_cut then
      update public.nesting_order_items set quantity_cut = v_cut where id = v_item.id;
      v_det := v_det || jsonb_build_array(jsonb_build_object(
        'op', v_op, 'antes', v_item.quantity_cut, 'depois', v_cut));
    end if;
  end loop;

  insert into public.nesting_history (nesting_id, event_type, from_status, to_status, details)
  values (p_nesting_id, 'Quantidades registradas', 'Em produção', 'Em produção', jsonb_build_object('alteracoes', v_det));
end $$;

-- ---------------------------------------------------------------------
-- CONCLUIR (exige a conferência de TODOS os itens do nesting)
-- ---------------------------------------------------------------------
create or replace function public.complete_nesting(p_nesting_id uuid, p_items jsonb, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_item public.nesting_order_items;
  r jsonb;
  v_cut numeric;
  v_op text;
  v_total integer;
  v_given integer;
  v_distinct integer;
  v_det jsonb := '[]'::jsonb;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para concluir o nesting.' using errcode = '42501';
  end if;
  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  if v_n.status <> 'Em produção' then
    raise exception 'Só é possível concluir um nesting Em produção (este está %).', v_n.status;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Envie a conferência das quantidades.';
  end if;

  select count(*) into v_total from public.nesting_order_items where nesting_id = p_nesting_id;
  select count(*), count(distinct (e ->> 'production_order_id'))
    into v_given, v_distinct from jsonb_array_elements(p_items) e;
  if v_total = 0 then
    raise exception 'O nesting não possui OPs vinculadas.';
  end if;
  if v_given <> v_total or v_distinct <> v_total then
    raise exception 'Confirme a quantidade cortada de TODAS as OPs do nesting (esperado: %, recebido: %).', v_total, v_given;
  end if;

  for r in select value from jsonb_array_elements(p_items) loop
    select * into v_item from public.nesting_order_items
     where nesting_id = p_nesting_id and production_order_id = (r ->> 'production_order_id')::uuid
     for update;
    if not found then
      raise exception 'Um dos itens informados não pertence a este nesting.';
    end if;
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
      'op', v_op, 'programado', v_item.quantity_programmed, 'cortado', v_cut));
  end loop;

  perform set_config('cgp.transicao', 'on', true);
  update public.nestings set status = 'Concluído', completed_at = now() where id = p_nesting_id;
  perform set_config('cgp.transicao', 'off', true);

  insert into public.nesting_history (nesting_id, event_type, from_status, to_status, note, details)
  values (p_nesting_id, 'Concluído', 'Em produção', 'Concluído',
          nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('itens', v_det));
end $$;

-- ---------------------------------------------------------------------
-- CANCELAR
--   Programado: sempre pode.
--   Em produção: só se NENHUMA quantidade cortada tiver sido registrada.
--   Concluído: não cancela (use Reabrir se precisar corrigir).
-- Nada é apagado; as quantidades de um nesting cancelado não entram em nenhum total.
-- ---------------------------------------------------------------------
create or replace function public.cancel_nesting(p_nesting_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para cancelar nestings.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  if v_n.status = 'Concluído' then
    raise exception 'Um nesting Concluído não pode ser cancelado. Se precisar corrigir, use Reabrir.';
  end if;
  if v_n.status = 'Cancelado' then
    raise exception 'Este nesting já está cancelado.';
  end if;
  if v_n.status = 'Em produção'
     and exists (select 1 from public.nesting_order_items where nesting_id = p_nesting_id and quantity_cut > 0) then
    raise exception 'Este nesting já tem peças cortadas registradas. Conclua-o com as quantidades reais em vez de cancelar.';
  end if;

  perform set_config('cgp.transicao', 'on', true);
  update public.nestings set status = 'Cancelado' where id = p_nesting_id;
  perform set_config('cgp.transicao', 'off', true);

  insert into public.nesting_history (nesting_id, event_type, from_status, to_status, note)
  values (p_nesting_id, 'Cancelado', v_n.status, 'Cancelado', btrim(p_reason));
end $$;

-- ---------------------------------------------------------------------
-- REABRIR UM NESTING CONCLUÍDO (ação explícita, com motivo, registrada no histórico)
-- Volta para "Em produção" para permitir corrigir quantidades; depois é só concluir de novo.
-- ---------------------------------------------------------------------
create or replace function public.reopen_nesting(p_nesting_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_item record;
  v_det jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para reabrir nestings.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo da reabertura.';
  end if;
  select * into v_n from public.nestings where id = p_nesting_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  if v_n.status <> 'Concluído' then
    raise exception 'Só é possível reabrir um nesting Concluído (este está %).', v_n.status;
  end if;

  -- Ao reabrir, a quantidade PROGRAMADA volta a contar. Garante que isso não gere excedente escondido.
  for v_item in
    select i.production_order_id, i.quantity_programmed, i.allow_excess, o.quantity as needed, o.op_number
      from public.nesting_order_items i
      join public.production_orders o on o.id = i.production_order_id
     where i.nesting_id = p_nesting_id
     order by i.production_order_id
  loop
    perform 1 from public.production_orders where id = v_item.production_order_id for update;
    if not v_item.allow_excess
       and public.cgp_item_allocated(v_item.production_order_id, p_nesting_id) + v_item.quantity_programmed > v_item.needed then
      raise exception using
        errcode = 'CG001',
        message = format(
          'Não é possível reabrir: a OP %s ficaria com mais peças programadas (%s) do que o necessário (%s) porque outro nesting já recebeu a sobra. Reduza o outro nesting primeiro.',
          v_item.op_number,
          public.cgp_fmt_qty(public.cgp_item_allocated(v_item.production_order_id, p_nesting_id) + v_item.quantity_programmed),
          public.cgp_fmt_qty(v_item.needed));
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('op', o.op_number, 'programado', i.quantity_programmed, 'cortado', i.quantity_cut))
    into v_det
    from public.nesting_order_items i
    join public.production_orders o on o.id = i.production_order_id
   where i.nesting_id = p_nesting_id;

  perform set_config('cgp.transicao', 'on', true);
  update public.nestings set status = 'Em produção', completed_at = null where id = p_nesting_id;
  perform set_config('cgp.transicao', 'off', true);

  insert into public.nesting_history (nesting_id, event_type, from_status, to_status, note, details)
  values (p_nesting_id, 'Reaberto', 'Concluído', 'Em produção', btrim(p_reason),
          jsonb_build_object('concluido_em', v_n.completed_at, 'quantidades_antes', coalesce(v_det, '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES DE EXECUÇÃO: somente usuários logados (nunca o visitante anônimo)
-- ---------------------------------------------------------------------
revoke all on function public.import_production_items(uuid, uuid, jsonb, boolean) from public, anon;
revoke all on function public.save_nesting(uuid, text, uuid, uuid, text, numeric, date, text, jsonb) from public, anon;
revoke all on function public.start_nesting(uuid) from public, anon;
revoke all on function public.record_nesting_cut(uuid, jsonb) from public, anon;
revoke all on function public.complete_nesting(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_nesting(uuid, text) from public, anon;
revoke all on function public.reopen_nesting(uuid, text) from public, anon;

grant execute on function public.import_production_items(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.save_nesting(uuid, text, uuid, uuid, text, numeric, date, text, jsonb) to authenticated;
grant execute on function public.start_nesting(uuid) to authenticated;
grant execute on function public.record_nesting_cut(uuid, jsonb) to authenticated;
grant execute on function public.complete_nesting(uuid, jsonb, text) to authenticated;
grant execute on function public.cancel_nesting(uuid, text) to authenticated;
grant execute on function public.reopen_nesting(uuid, text) to authenticated;
