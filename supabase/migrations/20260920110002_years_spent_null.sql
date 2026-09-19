-- app.years_spent(null) answered 0: greatest() skips nulls, so greatest(0, year - null) is 0, not
-- null. Every caller already checks for a missing joining year first, so no row was affected,
-- but "unknown" must not read as "joined this year" to the next caller.
create or replace function app.years_spent(p_joined_year int)
returns int
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_joined_year is not null then greatest(0, app.academic_year_start() - p_joined_year)
  end
$$;
