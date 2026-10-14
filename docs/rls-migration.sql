-- ============================================================
-- Закрыть доступ к данным: только для вошедшего пользователя
-- ============================================================
-- Было: политика "allow all" на роль public с using(true) —
-- любой, кто взял publishable-ключ из исходника страницы,
-- мог читать, менять и удалять все записи.
--
-- Стало: доступ только для роли authenticated, то есть для
-- того, кто вошёл через Supabase Auth. Анонимные запросы
-- отбиваются на уровне базы.
--
-- ПОРЯДОК ПРИМЕНЕНИЯ (важен):
--   1. Создать пользователя: Authentication → Users → Add user
--      (email + пароль, галка Auto Confirm User).
--   2. Задеплоить версию приложения с экраном входа и войти в неё.
--   3. Только после этого выполнить этот файл в SQL Editor.
-- Если выполнить раньше шага 2, приложение перестанет
-- загружать данные, пока не появится экран входа.
-- ============================================================

begin;

-- readings
drop policy if exists "allow all" on public.readings;
create policy "authenticated_all" on public.readings
  for all to authenticated using (true) with check (true);

-- tariffs
drop policy if exists "allow all" on public.tariffs;
create policy "authenticated_all" on public.tariffs
  for all to authenticated using (true) with check (true);

-- advances
drop policy if exists "allow all" on public.advances;
create policy "authenticated_all" on public.advances
  for all to authenticated using (true) with check (true);

-- settlements
drop policy if exists "allow all" on public.settlements;
create policy "authenticated_all" on public.settlements
  for all to authenticated using (true) with check (true);

-- settings
drop policy if exists "allow all" on public.settings;
create policy "authenticated_all" on public.settings
  for all to authenticated using (true) with check (true);

-- expenses
drop policy if exists "allow all" on public.expenses;
create policy "authenticated_all" on public.expenses
  for all to authenticated using (true) with check (true);

commit;

-- ─── Проверка: все шесть таблиц должны быть rls_on = true,
--     policies = 1, roles = {authenticated} ──────────────────
select t.tablename,
       t.rowsecurity as rls_on,
       p.policyname,
       p.roles,
       p.cmd
from pg_tables t
left join pg_policies p
       on p.schemaname = 'public' and p.tablename = t.tablename
where t.schemaname = 'public'
order by t.tablename;
