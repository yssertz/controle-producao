-- =====================================================================
-- 0003: AUTENTICAÇÃO, PERFIS E ROW LEVEL SECURITY (RLS)
--
-- Substitui as policies anônimas do protótipo por regras baseadas no usuário logado.
--
-- PERFIS (coluna user_profiles.role):
--   admin     -> tudo, inclusive configurar linhas, máquinas e setores
--   pcp       -> cadastra/edita listas, itens e nestings; inicia, conclui, cancela e reabre
--   operador  -> consulta tudo; inicia nesting, registra quantidades cortadas e conclui
--   leitura   -> somente consulta
--
-- SEGURANÇA: todo usuário novo nasce com active = false (sem acesso a nada).
-- Um admin precisa liberar (veja o README: "Criar o primeiro administrador").
-- Recomendado: desligar "Allow new users to sign up" no painel do Supabase (Auth > Sign In / Providers)
-- e criar os usuários manualmente (Auth > Users > Add user).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFIS
-- ---------------------------------------------------------------------
create table if not exists public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'leitura' check (role in ('admin', 'pcp', 'operador', 'leitura')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é criado no Supabase Auth.
create or replace function public.cgp_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists cgp_on_auth_user_created on auth.users;
create trigger cgp_on_auth_user_created
  after insert on auth.users
  for each row execute function public.cgp_handle_new_user();

-- Usuários que já existiam antes desta migração (ficam inativos até um admin liberar).
insert into public.user_profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. FUNÇÕES AUXILIARES DE PERMISSÃO
--    (security definer: leem user_profiles sem cair em recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.cgp_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.user_profiles where id = auth.uid() and active
$$;

create or replace function public.cgp_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select public.cgp_role() is not null
$$;

create or replace function public.cgp_can_plan()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.cgp_role() in ('admin', 'pcp'), false)
$$;

create or replace function public.cgp_can_operate()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.cgp_role() in ('admin', 'pcp', 'operador'), false)
$$;

create or replace function public.cgp_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.cgp_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------
-- 3. REMOVE O ACESSO ANÔNIMO DO PROTÓTIPO
-- ---------------------------------------------------------------------
drop policy if exists "prototype lists anon" on public.production_lists;
drop policy if exists "prototype orders anon" on public.production_orders;
drop policy if exists "prototype nestings anon" on public.nestings;
drop policy if exists "prototype nesting links anon" on public.nesting_order_items;
drop policy if exists "prototype sectors anon" on public.production_sectors;
drop policy if exists "prototype routes anon" on public.production_routes;
drop policy if exists "prototype route steps anon" on public.production_route_steps;
drop policy if exists "prototype order steps anon" on public.production_order_steps;
drop policy if exists "prototype logs anon" on public.production_logs;

-- Defesa extra: o papel "anon" (visitante sem login) não tem nenhum privilégio nas tabelas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------
-- 4. RLS: LEITURA para qualquer usuário ativo
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'production_lines', 'laser_machines', 'production_lists', 'production_orders',
    'nestings', 'nesting_order_items', 'nesting_history',
    'production_sectors', 'production_routes', 'production_route_steps',
    'production_order_steps', 'production_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "cgp_select" on public.%I', t);
    execute format('create policy "cgp_select" on public.%I for select to authenticated using (public.cgp_can_read())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. RLS: ESCRITA
--    (os triggers da migração 0002 ainda validam as regras de negócio)
-- ---------------------------------------------------------------------
-- 5.1 Planejadores (admin e pcp): listas, itens, nestings e vínculos.
--     Não há policy de DELETE em listas/itens/nestings: use arquivar/cancelar.
do $$
declare
  t text;
begin
  foreach t in array array['production_lists', 'production_orders', 'nestings'] loop
    execute format('drop policy if exists "cgp_insert" on public.%I', t);
    execute format('drop policy if exists "cgp_update" on public.%I', t);
    execute format('create policy "cgp_insert" on public.%I for insert to authenticated with check (public.cgp_can_plan())', t);
    execute format('create policy "cgp_update" on public.%I for update to authenticated using (public.cgp_can_plan()) with check (public.cgp_can_plan())', t);
  end loop;
end $$;

drop policy if exists "cgp_insert" on public.nesting_order_items;
drop policy if exists "cgp_update" on public.nesting_order_items;
drop policy if exists "cgp_delete" on public.nesting_order_items;
create policy "cgp_insert" on public.nesting_order_items for insert to authenticated with check (public.cgp_can_plan());
create policy "cgp_update" on public.nesting_order_items for update to authenticated using (public.cgp_can_plan()) with check (public.cgp_can_plan());
create policy "cgp_delete" on public.nesting_order_items for delete to authenticated using (public.cgp_can_plan());

-- nesting_history: sem policy de escrita. Só as funções (security definer) gravam.

-- 5.2 Somente admin: cadastros de configuração
do $$
declare
  t text;
begin
  foreach t in array array[
    'production_lines', 'laser_machines', 'production_sectors',
    'production_routes', 'production_route_steps'
  ] loop
    execute format('drop policy if exists "cgp_insert" on public.%I', t);
    execute format('drop policy if exists "cgp_update" on public.%I', t);
    execute format('create policy "cgp_insert" on public.%I for insert to authenticated with check (public.cgp_is_admin())', t);
    execute format('create policy "cgp_update" on public.%I for update to authenticated using (public.cgp_is_admin()) with check (public.cgp_is_admin())', t);
  end loop;
end $$;

-- 5.3 Etapas e apontamentos (estrutura pronta para a Fase 6)
do $$
declare
  t text;
begin
  foreach t in array array['production_order_steps', 'production_logs'] loop
    execute format('drop policy if exists "cgp_insert" on public.%I', t);
    execute format('drop policy if exists "cgp_update" on public.%I', t);
    execute format('create policy "cgp_insert" on public.%I for insert to authenticated with check (public.cgp_can_operate())', t);
    execute format('create policy "cgp_update" on public.%I for update to authenticated using (public.cgp_can_operate()) with check (public.cgp_can_operate())', t);
  end loop;
end $$;

-- 5.4 Perfis: cada um vê o próprio; usuários ativos veem os colegas (nomes no histórico);
--     somente admin altera perfis (inclusive papel e ativação).
alter table public.user_profiles enable row level security;
drop policy if exists "cgp_profiles_select" on public.user_profiles;
drop policy if exists "cgp_profiles_update" on public.user_profiles;
create policy "cgp_profiles_select" on public.user_profiles
  for select to authenticated using (id = auth.uid() or public.cgp_can_read());
create policy "cgp_profiles_update" on public.user_profiles
  for update to authenticated using (public.cgp_is_admin()) with check (public.cgp_is_admin());
