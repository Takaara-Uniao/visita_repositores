-- ============================================================
-- Visitas e despesas — esquema do banco (Supabase / Postgres)
-- Rodar UMA vez em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) Perfis (um por usuário do login) ------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  role       text not null default 'colaborador' check (role in ('supervisor','colaborador')),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cria o perfil sozinho quando um usuário é criado no painel
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quem é supervisor? (usado nas regras de acesso)
create or replace function public.is_supervisor()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'supervisor' and ativo
  );
$$;

-- 2) Visitas com despesas -----------------------------------
create table if not exists public.visitas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id),
  data          date not null,
  cidade        text,
  loja          text not null,
  motivo        text not null check (motivo in ('M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11')),
  acompanhante  text,
  veiculo       text,
  km_saida      integer check (km_saida   between 0 and 999999),
  km_chegada    integer check (km_chegada between 0 and 999999),
  -- custos do próprio lançador
  comb          numeric(12,2) not null default 0 check (comb   >= 0),
  ped           numeric(12,2) not null default 0 check (ped    >= 0),
  alim          numeric(12,2) not null default 0 check (alim   >= 0),
  hosp          numeric(12,2) not null default 0 check (hosp   >= 0),
  outros        numeric(12,2) not null default 0 check (outros >= 0),
  -- custos do acompanhante (colunas próprias, não misturam com "outros")
  ac_alim       numeric(12,2) not null default 0 check (ac_alim   >= 0),
  ac_hosp       numeric(12,2) not null default 0 check (ac_hosp   >= 0),
  ac_outros     numeric(12,2) not null default 0 check (ac_outros >= 0),
  obs           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- KM rodado calculado pelo banco; nunca negativo
  km integer generated always as (
    case when km_saida > 0 and km_chegada >= km_saida then km_chegada - km_saida else 0 end
  ) stored,
  total numeric(12,2) generated always as (
    comb + ped + alim + hosp + outros + ac_alim + ac_hosp + ac_outros
  ) stored,

  constraint km_chegada_maior_ou_igual check (km_chegada is null or km_saida is null or km_chegada >= km_saida),
  constraint km_dia_plausivel          check (km_chegada is null or km_saida is null or km_chegada - km_saida <= 1000)
);

create index if not exists visitas_user_data_idx on public.visitas (user_id, data desc);
create index if not exists visitas_data_idx      on public.visitas (data desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists visitas_touch on public.visitas;
create trigger visitas_touch before update on public.visitas
  for each row execute function public.touch_updated_at();

-- 3) Regras de acesso (RLS) ----------------------------------
alter table public.profiles enable row level security;
alter table public.visitas  enable row level security;

-- Perfis: cada um lê o seu; supervisor lê todos. Ninguém altera pelo app
-- (papel e nome são mudados só pelo SQL Editor).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_supervisor());

-- Visitas: colaborador só enxerga e mexe no que é dele.
-- Supervisor enxerga tudo, mas só altera o que ele mesmo lançou.
drop policy if exists visitas_select on public.visitas;
create policy visitas_select on public.visitas
  for select to authenticated
  using (user_id = auth.uid() or public.is_supervisor());

drop policy if exists visitas_insert on public.visitas;
create policy visitas_insert on public.visitas
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists visitas_update on public.visitas;
create policy visitas_update on public.visitas
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists visitas_delete on public.visitas;
create policy visitas_delete on public.visitas
  for delete to authenticated
  using (user_id = auth.uid());

-- 4) Última chegada de um veículo (para conferir a saída) ----
-- Roda com permissão elevada porque o hodômetro é do veículo, não da pessoa:
-- devolve só um número, sem expor lançamentos de outros.
create or replace function public.ultimo_km(p_veiculo text)
returns integer language sql security definer stable set search_path = public as $$
  select km_chegada from public.visitas
  where veiculo = p_veiculo and km_chegada > 0
  order by data desc, created_at desc
  limit 1;
$$;
revoke all on function public.ultimo_km(text) from public;
grant execute on function public.ultimo_km(text) to authenticated;

-- ============================================================
-- DEPOIS de criar os usuários (Authentication > Users > Add user),
-- tornar o Eliezer supervisor (troque o e-mail):
--
--   update public.profiles set role = 'supervisor', nome = 'Eliezer'
--   where id = (select id from auth.users where email = 'EMAIL_DO_ELIEZER');
--
-- Para ajustar o nome de um colaborador:
--
--   update public.profiles set nome = 'Natan'
--   where id = (select id from auth.users where email = 'EMAIL_DO_COLABORADOR');
-- ============================================================
