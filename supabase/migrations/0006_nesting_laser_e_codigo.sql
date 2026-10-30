-- =====================================================================
-- 0006: REGRAS DEFINIDAS PELA FÁBRICA
--   1. Nesting só aceita peças de linhas marcadas "allows_nesting"
--      (por padrão apenas a linha 'LASER 6KW/40KW'; o admin pode habilitar outras em Setores e linhas).
--   2. Código do nesting segue a sequência L0001, L0002... (única no sistema inteiro,
--      independente da máquina). A função next_nesting_code() sugere o próximo número.
--   3. Reabrir nesting concluído: somente admin e pcp (já era assim; nada a alterar).
-- Pode ser executada mais de uma vez.
-- =====================================================================

-- 1. Linhas que podem ir para nesting ------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'production_lines' and column_name = 'allows_nesting'
  ) then
    alter table public.production_lines add column allows_nesting boolean not null default false;
    update public.production_lines set allows_nesting = true where name = 'LASER 6KW/40KW';
  end if;
end $$;

create or replace function public.cgp_noi_line_guard()
returns trigger language plpgsql as $$
declare
  v_ok boolean;
  v_line text;
  v_op text;
begin
  -- Vínculo que já existe (edição do mesmo nesting) não é reavaliado.
  if exists (select 1 from public.nesting_order_items
              where nesting_id = new.nesting_id and production_order_id = new.production_order_id) then
    return new;
  end if;

  select pl.allows_nesting, pl.name, o.op_number
    into v_ok, v_line, v_op
    from public.production_orders o
    left join public.production_lines pl on pl.id = o.production_line_id
   where o.id = new.production_order_id;

  if not coalesce(v_ok, false) then
    raise exception 'A OP % está na linha "%" e não pode entrar em nesting: nestings aceitam apenas peças de linhas de laser habilitadas.',
      v_op, coalesce(v_line, 'sem linha');
  end if;
  return new;
end $$;

drop trigger if exists cgp_line_guard on public.nesting_order_items;
create trigger cgp_line_guard before insert on public.nesting_order_items
  for each row execute function public.cgp_noi_line_guard();

-- 2. Formato do código: L0001, L0002... ---------------------------------
create or replace function public.cgp_nesting_code_format()
returns trigger language plpgsql as $$
begin
  new.code := upper(btrim(new.code));
  if tg_op = 'INSERT' or new.code is distinct from old.code then
    if new.code !~ '^L[0-9]{4,}$' then
      raise exception 'Código inválido "%": use a sequência L0001, L0002... (letra L seguida de 4 ou mais dígitos).', new.code;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cgp_code_format on public.nestings;
create trigger cgp_code_format before insert or update on public.nestings
  for each row execute function public.cgp_nesting_code_format();

create or replace function public.next_nesting_code()
returns text
language sql
stable
set search_path = public
as $$
  select 'L' || lpad(
    (coalesce(max((substring(code from '^L([0-9]+)$'))::bigint), 0) + 1)::text, 4, '0')
  from public.nestings;
$$;

revoke all on function public.next_nesting_code() from public, anon;
grant execute on function public.next_nesting_code() to authenticated;
