-- =====================================================================
-- 0009: EXCLUSÃO DEFINITIVA (listas, itens/OPs e nestings)
--
-- A exclusão é REAL (DELETE no banco), mas só acontece por estas funções, que:
--   - verificam permissão (admin e pcp);
--   - verificam dependências ANTES de apagar (nada é apagado em cascata sem aviso);
--   - gravam um registro permanente em deletion_log (quem, quando, o quê);
--   - rodam em uma única transação: se algo falhar, nada é apagado.
-- Continua NÃO existindo policy de DELETE nas tabelas: o acesso direto pela API segue bloqueado.
--
-- REGRAS
--   Item (OP):  só exclui se NÃO estiver em nenhum nesting, NÃO tiver etapas/apontamentos de
--               produção e NÃO tiver nota fiscal registrada.
--   Lista:      sem itens -> exclui. Com itens -> só se TODOS os itens puderem ser excluídos
--               (exclusão da lista com seus itens, com confirmação explícita). Qualquer item
--               bloqueado impede a exclusão inteira.
--   Nesting:    Programado ou Cancelado (sem peças cortadas) -> admin e pcp excluem.
--               Em produção / Concluído (ou com peças cortadas) -> SOMENTE administrador,
--               com confirmação forçada; o saldo das OPs é recalculado automaticamente.
-- Pode ser executada mais de uma vez.
-- =====================================================================

create table if not exists public.deletion_log (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('lista', 'item', 'nesting')),
  entity_label  text not null,
  forced        boolean not null default false,
  details       jsonb,
  deleted_by    uuid default auth.uid(),
  deleted_at    timestamptz not null default now()
);
create index if not exists deletion_log_at_idx on public.deletion_log (deleted_at desc);

alter table public.deletion_log enable row level security;
drop policy if exists "cgp_select" on public.deletion_log;
create policy "cgp_select" on public.deletion_log for select to authenticated using (public.cgp_can_plan());
revoke all on public.deletion_log from anon;
-- sem policy de escrita: somente as funções abaixo gravam

-- ---------------------------------------------------------------------
-- Motivos que impedem excluir um item (nulo = pode excluir). Uso interno.
-- ---------------------------------------------------------------------
create or replace function public.cgp_item_blockers(p_item_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_codes text;
  v_n integer;
  v_inv text;
  v_reasons text[] := '{}';
begin
  select string_agg(distinct n.code, ', ' order by n.code), count(*)
    into v_codes, v_n
    from public.nesting_order_items i
    join public.nestings n on n.id = i.nesting_id
   where i.production_order_id = p_item_id;
  if v_n > 0 then
    v_reasons := v_reasons || ('participa dos nestings ' || v_codes);
  end if;

  if exists (select 1 from public.production_order_steps s
              where s.production_order_id = p_item_id
                and (s.status <> 'Aguardando' or s.quantity_started > 0 or s.quantity_completed > 0))
     or exists (select 1 from public.production_logs l
                  join public.production_order_steps s on s.id = l.order_step_id
                 where s.production_order_id = p_item_id) then
    v_reasons := v_reasons || 'tem etapas ou apontamentos de produção registrados';
  end if;

  select invoice_number into v_inv from public.production_orders where id = p_item_id;
  if v_inv is not null and btrim(v_inv) <> '' then
    v_reasons := v_reasons || ('tem nota fiscal registrada (' || v_inv || ')');
  end if;

  if array_length(v_reasons, 1) is null then
    return null;
  end if;
  return array_to_string(v_reasons, '; ');
end $$;

-- ---------------------------------------------------------------------
-- Exclui itens que podem ser excluídos e devolve os bloqueados. Uso interno.
-- ---------------------------------------------------------------------
create or replace function public.cgp_delete_item_rows(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_op text; v_code text; v_qty numeric; v_list text;
  v_reason text;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
begin
  for v_id in select distinct x from unnest(p_ids) x order by x loop
    select o.op_number, o.item_code, o.quantity, l.name
      into v_op, v_code, v_qty, v_list
      from public.production_orders o
      left join public.production_lists l on l.id = o.list_id
     where o.id = v_id
       for update of o;
    if not found then
      continue;
    end if;

    v_reason := public.cgp_item_blockers(v_id);
    if v_reason is not null then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'op_number', v_op, 'item_code', v_code, 'reason', v_reason));
    else
      -- etapas "Aguardando" sem produção são apenas esqueleto: podem sair junto
      delete from public.production_order_steps where production_order_id = v_id;
      delete from public.production_orders where id = v_id;
      v_deleted := v_deleted || jsonb_build_array(jsonb_build_object(
        'op', v_op, 'item', v_code, 'quantidade', v_qty, 'lista', v_list));
    end if;
  end loop;

  return jsonb_build_object('deleted_items', v_deleted, 'blocked', v_blocked);
end $$;

-- ---------------------------------------------------------------------
-- Guarda dos vínculos nesting x item: igual à 0007, mas a remoção dos vínculos é liberada
-- quando o próprio nesting está sendo excluído por delete_nesting (chave cgp.transicao).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- ITENS: informação prévia (para a tela de confirmação)
-- ---------------------------------------------------------------------
create or replace function public.delete_items_info(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_reason text;
  v_deletable integer := 0;
  v_total integer := 0;
  v_blocked jsonb := '[]'::jsonb;
  v_sample jsonb := '[]'::jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir itens.' using errcode = '42501';
  end if;
  for r in
    select o.id, o.op_number, o.item_code
      from public.production_orders o
     where o.id = any (p_ids)
     order by o.op_number, o.item_code
  loop
    v_total := v_total + 1;
    v_reason := public.cgp_item_blockers(r.id);
    if v_reason is null then
      v_deletable := v_deletable + 1;
      if jsonb_array_length(v_sample) < 8 then
        v_sample := v_sample || to_jsonb('OP ' || r.op_number || ' / ' || coalesce(r.item_code, 'sem código'));
      end if;
    elsif jsonb_array_length(v_blocked) < 50 then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'op_number', r.op_number, 'item_code', r.item_code, 'reason', v_reason));
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'deletable', v_deletable, 'blocked', v_blocked, 'sample', v_sample);
end $$;

-- ITENS: exclusão (apaga só os que não têm dependências; devolve os mantidos)
create or replace function public.delete_items(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
  v_n integer;
  v_items jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir itens.' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'Nenhum item selecionado.';
  end if;
  if array_length(p_ids, 1) > 1000 then
    raise exception 'Exclua no máximo 1000 itens por vez.';
  end if;

  v_res := public.cgp_delete_item_rows(p_ids);
  v_items := v_res -> 'deleted_items';
  v_n := jsonb_array_length(v_items);

  if v_n > 0 then
    insert into public.deletion_log (entity_type, entity_label, details)
    values ('item',
            case when v_n = 1 then 'OP ' || (v_items -> 0 ->> 'op') || ' / ' || coalesce(v_items -> 0 ->> 'item', 'sem código')
                 else v_n || ' itens' end,
            jsonb_build_object('itens', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                                           from (select e from jsonb_array_elements(v_items) e limit 500) t)));
  end if;

  return jsonb_build_object('deleted', v_n, 'blocked', v_res -> 'blocked');
end $$;

-- ---------------------------------------------------------------------
-- LISTAS
-- ---------------------------------------------------------------------
create or replace function public.delete_list_info(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_l public.production_lists;
  v_items integer;
  v_qty numeric;
  v_blocked integer := 0;
  v_sample jsonb := '[]'::jsonb;
  v_legacy integer;
  r record;
  v_reason text;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir listas.' using errcode = '42501';
  end if;
  select * into v_l from public.production_lists where id = p_id;
  if not found then
    raise exception 'Lista não encontrada.';
  end if;
  select count(*), coalesce(sum(quantity), 0) into v_items, v_qty from public.production_orders where list_id = p_id;
  select count(*) into v_legacy from public.nestings where list_id = p_id;

  for r in select id, op_number, item_code from public.production_orders where list_id = p_id order by op_number loop
    v_reason := public.cgp_item_blockers(r.id);
    if v_reason is not null then
      v_blocked := v_blocked + 1;
      if jsonb_array_length(v_sample) < 5 then
        v_sample := v_sample || jsonb_build_array(jsonb_build_object(
          'op_number', r.op_number, 'item_code', r.item_code, 'reason', v_reason));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'name', v_l.name, 'code', v_l.code, 'items', v_items, 'qty_total', v_qty,
    'blocked_count', v_blocked, 'blocked_sample', v_sample, 'legacy_nestings', v_legacy);
end $$;

create or replace function public.delete_list(p_id uuid, p_with_items boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l public.production_lists;
  v_items integer;
  v_ids uuid[];
  v_msg text;
  v_res jsonb;
  v_deleted jsonb;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir listas.' using errcode = '42501';
  end if;
  select * into v_l from public.production_lists where id = p_id for update;
  if not found then
    raise exception 'Lista não encontrada.';
  end if;

  if exists (select 1 from public.nestings where list_id = p_id) then
    raise exception 'A lista está ligada a nestings antigos (cadastro do protótipo) e não pode ser excluída.';
  end if;

  select array_agg(id) into v_ids from public.production_orders where list_id = p_id;
  v_items := coalesce(array_length(v_ids, 1), 0);

  if v_items > 0 and not p_with_items then
    raise exception 'A lista tem % item(ns). Confirme a exclusão da lista com seus itens ou exclua os itens antes.', v_items;
  end if;

  if v_items > 0 then
    -- tudo ou nada: se houver QUALQUER item com dependência, nada é apagado
    select string_agg('OP ' || op_number || ' / ' || coalesce(item_code, 'sem código') || ' (' || reason || ')', '; ')
      into v_msg
      from (
        select o.op_number, o.item_code, public.cgp_item_blockers(o.id) as reason
          from public.production_orders o
         where o.list_id = p_id
         order by o.op_number
      ) x
     where reason is not null;
    if v_msg is not null then
      raise exception 'Não é possível excluir a lista: há itens com dependências. %', left(v_msg, 600);
    end if;

    v_res := public.cgp_delete_item_rows(v_ids);
    if jsonb_array_length(v_res -> 'blocked') > 0 then
      raise exception 'Não é possível excluir a lista: um item passou a ter dependências durante a exclusão. Tente novamente.';
    end if;
    v_deleted := v_res -> 'deleted_items';
  else
    v_deleted := '[]'::jsonb;
  end if;

  delete from public.production_lists where id = p_id;

  insert into public.deletion_log (entity_type, entity_label, details)
  values ('lista', coalesce(v_l.code || ' - ', '') || v_l.name,
          jsonb_build_object('tipo', v_l.list_type, 'status', v_l.status, 'itens_excluidos', v_items,
                             'itens', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                                         from (select e from jsonb_array_elements(v_deleted) e limit 500) t)));

  return jsonb_build_object('deleted_items', v_items);
end $$;

-- ---------------------------------------------------------------------
-- NESTINGS
-- ---------------------------------------------------------------------
create or replace function public.delete_nesting_info(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_items integer;
  v_cut numeric;
  v_lists text;
  v_events integer;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir nestings.' using errcode = '42501';
  end if;
  select * into v_n from public.nestings where id = p_id;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;
  select count(*), coalesce(sum(quantity_cut), 0) into v_items, v_cut
    from public.nesting_order_items where nesting_id = p_id;
  select string_agg(distinct coalesce(l.code || ' - ', '') || l.name, ', ') into v_lists
    from public.nesting_order_items i
    join public.production_orders o on o.id = i.production_order_id
    join public.production_lists l on l.id = o.list_id
   where i.nesting_id = p_id;
  select count(*) into v_events from public.nesting_history where nesting_id = p_id;

  return jsonb_build_object(
    'code', v_n.code, 'status', v_n.status, 'items', v_items, 'cut_total', v_cut,
    'lists', v_lists, 'events', v_events,
    'safe', (v_n.status in ('Programado', 'Cancelado') and v_cut = 0),
    'is_admin', public.cgp_is_admin());
end $$;

create or replace function public.delete_nesting(p_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n public.nestings;
  v_cut numeric;
  v_items jsonb;
  v_events integer;
  v_safe boolean;
begin
  if not public.cgp_can_plan() then
    raise exception 'Você não tem permissão para excluir nestings.' using errcode = '42501';
  end if;
  select * into v_n from public.nestings where id = p_id for update;
  if not found then
    raise exception 'Nesting não encontrado.';
  end if;

  select coalesce(sum(quantity_cut), 0) into v_cut from public.nesting_order_items where nesting_id = p_id;
  v_safe := v_n.status in ('Programado', 'Cancelado') and v_cut = 0;

  if not v_safe then
    if not public.cgp_is_admin() then
      raise exception 'O nesting % está % e já tem produção registrada: somente um administrador pode excluí-lo. Se ainda não houver peças cortadas, use Cancelar.', v_n.code, v_n.status;
    end if;
    if not p_force then
      raise exception 'A exclusão de um nesting % exige confirmação forçada.', v_n.status;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'op', o.op_number, 'item', o.item_code, 'programada', i.quantity_programmed, 'cortada', i.quantity_cut)), '[]'::jsonb)
    into v_items
    from public.nesting_order_items i
    join public.production_orders o on o.id = i.production_order_id
   where i.nesting_id = p_id;
  select count(*) into v_events from public.nesting_history where nesting_id = p_id;

  insert into public.deletion_log (entity_type, entity_label, forced, details)
  values ('nesting', v_n.code, not v_safe,
          jsonb_build_object('status', v_n.status, 'maquina_id', v_n.laser_machine_id, 'chapa', v_n.material,
                             'iniciado_em', v_n.started_at, 'concluido_em', v_n.completed_at,
                             'total_cortado', v_cut, 'eventos_historico', v_events, 'itens', v_items));

  -- os vínculos (nesting_order_items) e o histórico saem junto; o registro fica em deletion_log
  perform set_config('cgp.transicao', 'on', true);
  delete from public.nestings where id = p_id;
  perform set_config('cgp.transicao', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES DE EXECUÇÃO
-- ---------------------------------------------------------------------
revoke all on function public.cgp_item_blockers(uuid) from public, anon, authenticated;
revoke all on function public.cgp_delete_item_rows(uuid[]) from public, anon, authenticated;
revoke all on function public.delete_items_info(uuid[]) from public, anon;
revoke all on function public.delete_items(uuid[]) from public, anon;
revoke all on function public.delete_list_info(uuid) from public, anon;
revoke all on function public.delete_list(uuid, boolean) from public, anon;
revoke all on function public.delete_nesting_info(uuid) from public, anon;
revoke all on function public.delete_nesting(uuid, boolean) from public, anon;
grant execute on function public.delete_items_info(uuid[]) to authenticated;
grant execute on function public.delete_items(uuid[]) to authenticated;
grant execute on function public.delete_list_info(uuid) to authenticated;
grant execute on function public.delete_list(uuid, boolean) to authenticated;
grant execute on function public.delete_nesting_info(uuid) to authenticated;
grant execute on function public.delete_nesting(uuid, boolean) to authenticated;
