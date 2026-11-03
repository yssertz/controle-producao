-- =====================================================================
-- 0011: ACOMPANHAMENTO DA PRODUÇÃO POR LISTA E LINHA (planilha de percentuais)
--
-- Percentual de uma linha numa lista = peças produzidas ÷ peças necessárias (dos itens dessa linha).
-- De onde vem o "produzido" (production_lines.progress_source):
--   'nesting' -> peças efetivamente cortadas nos nestings (linhas de laser "puras": 6KW, 12KW, 40KW)
--   'manual'  -> apontamento do usuário (production_orders.qty_done): GEKA, guilhotina, serra, usinagem,
--                dobra e demais linhas (inclusive laser + dobra/usinagem, cujo processo final não é o corte)
-- O total da lista = soma produzida ÷ soma necessária de todas as linhas (ponderado pela quantidade de peças).
-- O admin pode trocar a origem de uma linha (coluna progress_source).
-- Pode ser executada mais de uma vez.
-- =====================================================================

alter table public.production_orders
  add column if not exists qty_done numeric(14,3) not null default 0;

alter table public.production_orders drop constraint if exists production_orders_done_ck;
alter table public.production_orders add constraint production_orders_done_ck check (qty_done >= 0);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'production_lines' and column_name = 'progress_source'
  ) then
    alter table public.production_lines
      add column progress_source text not null default 'manual' check (progress_source in ('nesting', 'manual'));
    update public.production_lines set progress_source = 'nesting'
     where name in ('LASER 6KW', 'LASER 12KW', 'LASER 40KW');
  end if;
end $$;

create or replace view public.list_line_progress
with (security_invoker = true) as
select
  b.list_id,
  l.code as list_code,
  l.name as list_name,
  l.delivery_date,
  b.production_line_id as line_id,
  pl.name as line_name,
  pl.sort_order,
  pl.progress_source,
  count(*)::integer as items,
  sum(b.qty_total) as qty_total,
  sum(least(case when pl.progress_source = 'nesting' then b.qty_cut else o.qty_done end, b.qty_total)) as qty_done
from public.production_item_balance b
join public.production_orders o on o.id = b.id
join public.production_lines pl on pl.id = b.production_line_id
join public.production_lists l on l.id = b.list_id
where b.archived_at is null
  and l.status <> 'Arquivada'
group by b.list_id, l.code, l.name, l.delivery_date, b.production_line_id, pl.name, pl.sort_order, pl.progress_source;

-- Apontamento do produzido (linhas com origem manual). p_rows: [{ "id": "...", "qty_done": 12 }]
create or replace function public.set_items_done(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_o record;
  v_q numeric;
  v_n integer := 0;
begin
  if not public.cgp_can_operate() then
    raise exception 'Você não tem permissão para apontar produção.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhum apontamento informado.';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Envie no máximo 1000 apontamentos por vez.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) order by (value ->> 'id') loop
    select o.id, o.op_number, o.quantity, pl.progress_source, l.list_type
      into v_o
      from public.production_orders o
      join public.production_lines pl on pl.id = o.production_line_id
      join public.production_lists l on l.id = o.list_id
     where o.id = (r ->> 'id')::uuid
       for update of o;
    if not found then
      raise exception 'Item não encontrado.';
    end if;
    if v_o.progress_source <> 'manual' then
      raise exception 'A produção da OP % vem dos nestings (peças cortadas), não de apontamento manual.', v_o.op_number;
    end if;

    v_q := nullif(btrim(coalesce(r ->> 'qty_done', '')), '')::numeric;
    if v_q is null or v_q < 0 or v_q > v_o.quantity then
      raise exception 'A quantidade produzida da OP % deve estar entre 0 e %.', v_o.op_number, public.cgp_fmt_qty(v_o.quantity);
    end if;

    update public.production_orders
       set qty_done = v_q,
           status = case
                      when v_o.list_type = 'Leniors' then status
                      when v_q >= quantity then 'Concluída'
                      when v_q > 0 then 'Em produção'
                      else 'Aguardando'
                    end
     where id = v_o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on public.list_line_progress from anon;
grant select on public.list_line_progress to authenticated;
revoke all on function public.set_items_done(jsonb) from public, anon;
grant execute on function public.set_items_done(jsonb) to authenticated;
