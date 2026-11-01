-- Recover V3.2 — schéma Supabase
-- À exécuter UNE FOIS dans Supabase > SQL Editor.

create table if not exists public.recover_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"purchases":[],"cases":[],"recovered":0}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.recover_states enable row level security;

grant select, insert, update, delete on table public.recover_states to authenticated;

drop policy if exists "recover_states_select_own" on public.recover_states;
create policy "recover_states_select_own"
on public.recover_states for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "recover_states_insert_own" on public.recover_states;
create policy "recover_states_insert_own"
on public.recover_states for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "recover_states_update_own" on public.recover_states;
create policy "recover_states_update_own"
on public.recover_states for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "recover_states_delete_own" on public.recover_states;
create policy "recover_states_delete_own"
on public.recover_states for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Bucket PRIVÉ pour les factures / justificatifs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recover-documents',
  'recover-documents',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Chaque utilisateur ne peut accéder qu'au dossier qui porte son propre UUID.
drop policy if exists "recover_docs_select_own" on storage.objects;
create policy "recover_docs_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'recover-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "recover_docs_insert_own" on storage.objects;
create policy "recover_docs_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'recover-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "recover_docs_update_own" on storage.objects;
create policy "recover_docs_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'recover-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'recover-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "recover_docs_delete_own" on storage.objects;
create policy "recover_docs_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'recover-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
