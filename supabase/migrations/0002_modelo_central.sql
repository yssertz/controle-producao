-- =====================================================================
-- 0002: MODELO CENTRAL
-- Evolui o schema do protótipo (0001) sem apagar dados existentes.
--
-- O que esta migração faz:
--   1. Cria as 13 linhas de produção padronizadas e as máquinas laser.
--   2. Ajusta listas, itens (production_orders), nestings e vínculos.
--   3. Cria o histórico de nestings.
--   4. Cria TRIGGERS que garantem as regras de negócio no banco
--      (não só na tela): lista do nesting, status, quantidades, excedente.
--
-- Pode ser executada mais de uma vez (usa "if not exists" / "drop ... if exists").
--
-- NOTA SOBRE LINHAS ANTIGAS: itens e nestings criados no protótipo sem lista/linha/máquina
-- continuam existindo, mas só poderão ser EDITADOS depois que receberem esses campos
-- (as restrições abaixo usam "not valid": valem para dados novos/alterados, não varrem o passado).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. LINHAS DE PRODUÇÃO (padronizadas)
-- ---------------------------------------------------------------------
create table if not exists public.production_lines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists production_lines_name_uk
  on public.production_lines (lower(btrim(name)));

insert into public.production_lines (name, sort_order) values
  ('GEKA', 10),
  ('GEKA DOBRA', 20),
  ('GEKA USINAGEM', 30),
  ('GUILHOTINA', 40),
  ('GUILHOTINA DOBRA', 50),
  ('GUILHOTINA USINAGEM', 60),
  ('LASER 6KW/40KW', 70),
  ('LASER 6KW/40KW DOBRA', 80),
  ('LASER 6KW/40KW USINAGEM', 90),
  ('SERRA', 100),
  ('SERRA DOBRA', 110),
  ('SERRA USINAGEM', 120),
  ('USINAGEM', 130)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. MÁQUINAS LASER (somente laser pode ser máquina de um nesting)
-- ---------------------------------------------------------------------
create table if not exists public.laser_machines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists laser_machines_name_uk
  on public.laser_machines (lower(btrim(name)));

insert into public.laser_machines (name, sort_order) values
  ('Laser 6KW', 10),
  ('Laser 40KW', 20)
on conflict do nothing;

-- Setores adicionais (o catálogo de setores é usado na Fase 6)
insert into public.production_sectors (name, is_external, sort_order) values
  ('GEKA', false, 5),
  ('Serra', false, 25)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 3. LISTAS DE PRODUÇÃO
-- ---------------------------------------------------------------------
alter table public.production_lists
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  create unique index if not exists production_lists_name_uk
    on public.production_lists (lower(btrim(name)));
exception when unique_violation then
  raise notice 'Já existem listas com nomes repetidos: o índice único de nome NÃO foi criado. Renomeie as repetidas e execute de novo.';
end $$;

-- ---------------------------------------------------------------------
-- 4. ITENS DE PRODUÇÃO (tabela production_orders)
--    Cada LINHA da tabela é UM ITEM de uma OP. Uma OP com vários itens
--    tem várias linhas com o mesmo op_number.
-- ---------------------------------------------------------------------
alter table public.production_orders
  add column if not exists production_line_id uuid references public.production_lines(id) on delete restrict,
  add column if not exists unit text not null default 'un',
  add column if not exists notes text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Não apagar a lista levando os itens junto (antes era "set null").
alter table public.production_orders drop constraint if exists production_orders_list_id_fkey;
alter table public.production_orders
  add constraint production_orders_list_id_fkey
  foreign key (list_id) references public.production_lists(id) on delete restrict;

-- Itens NOVOS precisam de lista, linha e número de OP preenchidos.
alter table public.production_orders drop constraint if exists production_orders_list_required_ck;
alter table public.production_orders
  add constraint production_orders_list_required_ck check (list_id is not null) not valid;

alter table public.production_orders drop constraint if exists production_orders_line_required_ck;
alter table public.production_orders
  add constraint production_orders_line_required_ck check (production_line_id is not null) not valid;

alter table public.production_orders drop constraint if exists production_orders_op_filled_ck;
alter table public.production_orders
  add constraint production_orders_op_filled_ck check (btrim(op_number) <> '') not valid;

-- Índice de apoio à regra de duplicidade (NÃO é único de propósito:
-- os critérios reais de identificação ainda podem mudar; a regra está na função de importação).
create index if not exists production_orders_dedup_idx
  on public.production_orders (list_id, production_line_id, (upper(btrim(op_number))));
create index if not exists production_orders_line_idx on public.production_orders (production_line_id);
create index if not exists production_orders_status_idx on public.production_orders (status);

-- ---------------------------------------------------------------------
-- 5. NESTINGS
-- ---------------------------------------------------------------------
alter table public.nestings
  add column if not exists list_id uuid references public.production_lists(id) on delete restrict,
  add column if not exists laser_machine_id uuid references public.laser_machines(id) on delete restrict,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- (a "chave" abaixo libera os UPDATEs de conversão mesmo se o trigger de guarda já existir)
select set_config('cgp.transicao', 'on', true);

-- Novos nomes de status: Programado -> Em produção -> Concluído (ou Cancelado)
alter table public.nestings drop constraint if exists nestings_status_check;
update public.nestings set status = 'Em produção' where status = 'Em corte';
update public.nestings set status = 'Concluído'   where status = 'Cortado';
alter table public.nestings
  add constraint nestings_status_check
  check (status in ('Programado', 'Em produção', 'Concluído', 'Cancelado'));

-- Tenta converter o texto livre antigo (machine_name) em máquina padronizada.
update public.nestings n
   set laser_machine_id = (select id from public.laser_machines where name = 'Laser 6KW')
 where n.laser_machine_id is null and n.machine_name ~* '(^|[^0-9])6\s*kw';
update public.nestings n
   set laser_machine_id = (select id from public.laser_machines where name = 'Laser 40KW')
 where n.laser_machine_id is null and n.machine_name ~* '(^|[^0-9])40\s*kw';
select set_config('cgp.transicao', 'off', true);
comment on column public.nestings.machine_name is 'LEGADO (protótipo). Use laser_machine_id.';

alter table public.nestings drop constraint if exists nestings_list_required_ck;
alter table public.nestings add constraint nestings_list_required_ck check (list_id is not null) not valid;
alter table public.nestings drop constraint if exists nestings_machine_required_ck;
alter table public.nestings add constraint nestings_machine_required_ck check (laser_machine_id is not null) not valid;
alter table public.nestings drop constraint if exists nestings_code_filled_ck;
alter table public.nestings add constraint nestings_code_filled_ck check (btrim(code) <> '') not valid;

-- Código único sem diferenciar maiúsculas/minúsculas (a coluna code já era única).
do $$
begin
  create unique index if not exists nestings_code_ci_uk on public.nestings (upper(btrim(code)));
exception when unique_violation then
  raise notice 'Existem códigos de nesting que só diferem por maiúsculas/minúsculas: índice não criado.';
end $$;

create index if not exists nestings_list_idx on public.nestings (list_id);
create index if not exists nestings_machine_idx on public.nestings (laser_machine_id);
create index if not exists nestings_status_idx on public.nestings (status);

-- ---------------------------------------------------------------------
-- 6. VÍNCULO NESTING x ITEM
-- ---------------------------------------------------------------------
alter table public.nesting_order_items
  add column if not exists notes text,
  add column if not exists allow_excess boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Quantidade programada > 0 (antes aceitava 0).
alter table public.nesting_order_items drop constraint if exists nesting_order_items_quantity_programmed_check;
alter table public.nesting_order_items drop constraint if exists noi_programmed_positive_ck;
alter table public.nesting_order_items
  add constraint noi_programmed_positive_ck check (quantity_programmed > 0) not valid;

-- Cortado nunca passa do programado.
alter table public.nesting_order_items drop constraint if exists noi_cut_within_programmed_ck;
alter table public.nesting_order_items
  add constraint noi_cut_within_programmed_ck check (quantity_cut <= quantity_programmed) not valid;

-- Não apagar um item que já tem histórico em nesting (antes era "cascade").
alter table public.nesting_order_items drop constraint if exists nesting_order_items_production_order_id_fkey;
alter table public.nesting_order_items
  add constraint nesting_order_items_production_order_id_fkey
  foreign key (production_order_id) references public.production_orders(id) on delete restrict;

create index if not exists noi_order_idx on public.nesting_order_items (production_order_id);
create index if not exists noi_nesting_idx on public.nesting_order_items (nesting_id);

-- ---------------------------------------------------------------------
-- 7. HISTÓRICO DE NESTINGS (criação, edição, início, quantidades, conclusão...)
-- ---------------------------------------------------------------------
create table if not exists public.nesting_history (
  id           uuid primary key default gen_random_uuid(),
  nesting_id   uuid not null references public.nestings(id) on delete cascade,
  event_type   text not null check (event_type in
                 ('Criado','Editado','Iniciado','Quantidades registradas','Concluído','Cancelado','Reaberto')),
  from_status  text,
  to_status    text,
  note         text,
  details      jsonb,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists nesting_history_nesting_idx on public.nesting_history (nesting_id, created_at);

-- ---------------------------------------------------------------------
-- 8. FUNÇÕES E TRIGGERS DE INTEGRIDADE
-- ---------------------------------------------------------------------

-- 8.0 Formata quantidade para mensagens em português: 12,5 (e não 12.500)
create or replace function public.cgp_fmt_qty(p_value numeric)
returns text language sql immutable as $$
  select replace(trim_scale(p_value)::text, '.', ',');
$$;

-- 8.1 Atualiza updated_at automaticamente
create or replace function public.cgp_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cgp_touch on public.production_lists;
create trigger cgp_touch before update on public.production_lists
  for each row execute function public.cgp_touch_updated_at();
drop trigger if exists cgp_touch on public.production_orders;
create trigger cgp_touch before update on public.production_orders
  for each row execute function public.cgp_touch_updated_at();
drop trigger if exists cgp_touch on public.nestings;
create trigger cgp_touch before update on public.nestings
  for each row execute function public.cgp_touch_updated_at();
drop trigger if exists cgp_touch on public.nesting_order_items;
create trigger cgp_touch before update on public.nesting_order_items
  for each row execute function public.cgp_touch_updated_at();

-- 8.2 Quanto de um item já está "alocado" em nestings (sem contar duas vezes):
--     - nesting Programado / Em produção  -> conta a quantidade PROGRAMADA
--     - nesting Concluído                 -> conta a quantidade REALMENTE CORTADA
--       (o que foi programado e não cortado volta a ficar pendente)
--     - nesting Cancelado                 -> não conta
create or replace function public.cgp_item_allocated(p_order_id uuid, p_exclude_nesting_id uuid default null)
returns numeric language sql stable as $$
  select coalesce(sum(case n.status when 'Concluído' then i.quantity_cut else i.quantity_programmed end), 0)
    from public.nesting_order_items i
    join public.nestings n on n.id = i.nesting_id
   where i.production_order_id = p_order_id
     and n.status in ('Programado', 'Em produção', 'Concluído')
     and (p_exclude_nesting_id is null or i.nesting_id <> p_exclude_nesting_id);
$$;

-- 8.3 Guarda da tabela nestings.
--     Mudanças de status/datas só passam pelas funções Iniciar/Concluir/Cancelar/Reabrir
--     (elas ligam a "chave" cgp.transicao dentro da própria transação).
create or replace function public.cgp_nestings_guard()
returns trigger language plpgsql as $$
declare
  v_transicao boolean := coalesce(current_setting('cgp.transicao', true), '') = 'on';
begin
  new.code := upper(btrim(new.code));
  if new.code = '' then
    raise exception 'Informe o código do nesting.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'Programado' or new.started_at is not null or new.completed_at is not null then
      raise exception 'Todo nesting nasce como Programado.';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.status is distinct from old.status
      or new.started_at is distinct from old.started_at
      or new.completed_at is distinct from old.completed_at) and not v_transicao then
    raise exception 'O status do nesting só muda pelas ações Iniciar, Concluir, Cancelar ou Reabrir.';
  end if;

  if old.status in ('Concluído', 'Cancelado') and not v_transicao then
    raise exception 'O nesting % está % e não pode ser alterado. Para corrigir um concluído, use a ação Reabrir.', old.code, old.status;
  end if;

  if old.status = 'Em produção' and not v_transicao and (
       new.code is distinct from old.code
       or new.list_id is distinct from old.list_id
       or new.laser_machine_id is distinct from old.laser_machine_id) then
    raise exception 'Depois de iniciado, o nesting não pode trocar código, lista ou máquina.';
  end if;

  if new.list_id is distinct from old.list_id
     and exists (select 1 from public.nesting_order_items where nesting_id = old.id) then
    raise exception 'Remova as OPs do nesting antes de trocar a lista.';
  end if;

  return new;
end $$;

drop trigger if exists cgp_guard on public.nestings;
create trigger cgp_guard before insert or update on public.nestings
  for each row execute function public.cgp_nestings_guard();

-- 8.4 Guarda dos vínculos nesting x item
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

  -- Trava o item: duas pessoas programando a mesma OP ao mesmo tempo ficam em fila,
  -- então a soma abaixo nunca é calculada com dados desatualizados.
  select * into v_o from public.production_orders where id = new.production_order_id for update;
  if not found then
    raise exception 'Item de produção não encontrado.';
  end if;

  -- REGRA: o item precisa ser da MESMA LISTA do nesting.
  if v_o.list_id is distinct from v_n.list_id then
    raise exception 'A OP % pertence a outra lista e não pode entrar no nesting % (lista diferente).', v_o.op_number, v_n.code;
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

  -- REGRA: a soma programada não pode passar do necessário sem autorização explícita.
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

drop trigger if exists cgp_guard on public.nesting_order_items;
create trigger cgp_guard before insert or update or delete on public.nesting_order_items
  for each row execute function public.cgp_noi_guard();

-- 8.5 Guarda dos itens de produção
create or replace function public.cgp_orders_guard()
returns trigger language plpgsql as $$
begin
  new.op_number := btrim(new.op_number);
  new.item_code := nullif(btrim(coalesce(new.item_code, '')), '');

  if tg_op = 'UPDATE' then
    if new.list_id is distinct from old.list_id
       and exists (select 1 from public.nesting_order_items where production_order_id = old.id) then
      raise exception 'Este item já participa de nestings e não pode mudar de lista.';
    end if;
    if new.archived_at is not null and old.archived_at is null
       and exists (
         select 1 from public.nesting_order_items i
           join public.nestings n on n.id = i.nesting_id
          where i.production_order_id = old.id and n.status in ('Programado', 'Em produção')) then
      raise exception 'Este item está em um nesting Programado ou Em produção. Cancele ou conclua o nesting antes de arquivar o item.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cgp_guard on public.production_orders;
create trigger cgp_guard before insert or update on public.production_orders
  for each row execute function public.cgp_orders_guard();
