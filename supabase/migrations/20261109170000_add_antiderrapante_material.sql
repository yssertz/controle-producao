alter table public.nestings
  drop constraint if exists nestings_sheet_material_type_check;

alter table public.nestings
  add constraint nestings_sheet_material_type_check
  check (
    sheet_material_type is null
    or sheet_material_type in (
      'A36_SAE1010_20_NORMAL',
      'A36_SAE1010_20_LNE',
      'GALVANIZADA',
      'INOX',
      'HARDOX',
      'STRENX',
      'ANTIDERRAPANTE'
    )
  );

create or replace function public.cgp_classify_sheet_material(p_material text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := upper(btrim(coalesce(p_material, '')));
begin
  if v = '' then return null; end if;

  -- Códigos de matéria-prima do ERP: 25096 = LNE; 22630 = Normal.
  if v ~ '(^|[^0-9])25096([^0-9]|$)' then return 'A36_SAE1010_20_LNE'; end if;
  if v ~ '(^|[^0-9])22630([^0-9]|$)' then return 'A36_SAE1010_20_NORMAL'; end if;

  if v ~ '(^|[^A-Z0-9])LNE([^A-Z0-9]|$)|LNE[- ]?[0-9]' then return 'A36_SAE1010_20_LNE'; end if;
  if v ~ 'ASTM[ -]*A[ -]*36|SAE[[:space:]]*1010[[:space:]]*/[[:space:]]*20' then return 'A36_SAE1010_20_NORMAL'; end if;
  if v like '%ANTIDERRAPANTE%' or v like '%PE DE GALINHA%' then return 'ANTIDERRAPANTE'; end if;
  if v like '%GALVANIZ%' then return 'GALVANIZADA'; end if;
  if v like '%INOX%' or v ~ 'AISI[[:space:]]*30[24]' then return 'INOX'; end if;
  if v like '%HARDOX%' then return 'HARDOX'; end if;
  if v like '%STRENX%' then return 'STRENX'; end if;
  return null;
end;
$$;

grant execute on function public.cgp_classify_sheet_material(text) to authenticated;
