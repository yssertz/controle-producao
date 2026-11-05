do $$
begin
  if exists (
    select 1 from public.production_orders o join public.production_lines l on l.id=o.production_line_id
     where l.name in ('LASER 6KW/40KW DOBRA','LASER 6KW/40KW','LASER 6KW/40KW USINAGEM')
  ) or exists (
    select 1 from public.erp_line_codes e join public.production_lines l on l.id=e.line_id
     where l.name in ('LASER 6KW/40KW DOBRA','LASER 6KW/40KW','LASER 6KW/40KW USINAGEM')
  ) then
    raise exception 'As linhas laser legadas ainda têm OPs ou códigos ERP vinculados; nenhuma foi removida.';
  end if;

  if exists (select 1 from public.production_routes) or exists (select 1 from public.production_route_steps) then
    raise exception 'As tabelas de roteiros contêm dados; a limpeza foi cancelada para preservar os registros.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.prosrc ilike '%production_routes%' or p.prosrc ilike '%production_route_steps%')
  ) then
    raise exception 'Há funções do banco usando as tabelas de roteiros; a limpeza foi cancelada.';
  end if;
end $$;

-- These legacy setup objects are empty and have no application or database-function consumers.
drop view if exists public.production_process_progress;
drop table public.production_route_steps;
drop table public.production_routes;

-- Remove the three requested line variants only after the checks above confirmed no OP or ERP references.
delete from public.production_line_processes m
 using public.production_lines l
 where m.production_line_id=l.id
   and l.name in ('LASER 6KW/40KW DOBRA','LASER 6KW/40KW','LASER 6KW/40KW USINAGEM');
delete from public.production_lines
 where name in ('LASER 6KW/40KW DOBRA','LASER 6KW/40KW','LASER 6KW/40KW USINAGEM');

-- Merge legacy Geka/GEKA stages: retain the uppercase sector and the earliest stage in each line.
delete from public.production_line_processes m
 using public.production_sectors s
 where s.id=m.sector_id and lower(btrim(s.name))='geka' and s.name <> 'GEKA';

delete from public.production_sectors s
 where lower(btrim(s.name))='geka' and s.name <> 'GEKA'
   and not exists (select 1 from public.production_line_processes m where m.sector_id=s.id)
   and not exists (select 1 from public.production_order_steps st where st.sector_id=s.id);

-- Drop catalog processes with no line, OP step, or route reference.
delete from public.production_sectors s
 where lower(btrim(s.name)) in ('acabamento','expedição','montagem','pintura','processo externo','solda')
   and not exists (select 1 from public.production_line_processes m where m.sector_id=s.id)
   and not exists (select 1 from public.production_order_steps st where st.sector_id=s.id);

update public.production_sectors
   set name=upper(regexp_replace(btrim(name),'\s+',' ','g'))
 where name <> upper(regexp_replace(btrim(name),'\s+',' ','g'));
update public.production_lines
   set name=upper(regexp_replace(btrim(name),'\s+',' ','g'))
 where name <> upper(regexp_replace(btrim(name),'\s+',' ','g'));

-- Close step-order gaps left by merged duplicate sectors.
with numbered as (
  select m.production_line_id,m.sector_id,
         row_number() over(partition by m.production_line_id order by m.step_order,m.sector_id)::integer as next_order
    from public.production_line_processes m
)
update public.production_line_processes m
   set step_order=n.next_order
  from numbered n
 where n.production_line_id=m.production_line_id and n.sector_id=m.sector_id
   and m.step_order is distinct from n.next_order;

create unique index if not exists production_lines_normalized_name_uidx
  on public.production_lines (upper(regexp_replace(btrim(name),'\s+',' ','g')));
create unique index if not exists production_sectors_normalized_name_uidx
  on public.production_sectors (lower(regexp_replace(btrim(name),'\s+',' ','g')));
