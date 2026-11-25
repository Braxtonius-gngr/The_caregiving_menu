-- Deleted entries are erased for good 30 days after they were deleted: the row, its edit
-- history, its extra photos and PDFs, and its photos in Storage. The daily job (function
-- /account, action purge, scheduled in 0022) calls the two server-only functions below.
-- Design: docs/private/product/design/step-c5-erase-deleted.md.

-- 1. When was it deleted? Stamped by the server, so a phone's clock can't move it.
create or replace function stamp_deleted_at() returns trigger language plpgsql as $$
begin
  if not new.deleted then new.deleted_at := null;
  elsif tg_op = 'INSERT' or not old.deleted then new.deleted_at := now();
  else new.deleted_at := old.deleted_at;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in select c.table_name::text from information_schema.columns c
           where c.table_schema = 'public' and c.column_name = 'deleted'
             and exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
             and exists (select 1 from information_schema.columns h where h.table_schema = 'public' and h.table_name = c.table_name and h.column_name = 'household_id')
           order by 1 loop
    execute format('alter table %I add column if not exists deleted_at timestamptz', t);
    execute format('drop trigger if exists %I on %I', t || '_deleted_at', t);
    execute format('create trigger %I before insert or update on %I for each row execute function stamp_deleted_at()', t || '_deleted_at', t);
    -- Rows deleted before today: their last change is when they were deleted. Filled in with
    -- triggers off, so nothing gets a new timestamp, a sync bump or a history line.
    set local session_replication_role = replica;
    execute format('update %I set deleted_at = updated_at where deleted and deleted_at is null', t);
    set local session_replication_role = origin;
    execute format('create index if not exists %I on %I (deleted_at) where deleted', t || '_deleted_at_idx', t);
  end loop;
end $$;

-- 2. Every row deleted more than `days` ago, plus the extra photos and PDFs attached to
-- those rows (deleted or not), with the table and family of each.
create or replace function expired_deleted_rows(days int default 30)
returns table (tbl text, row_id uuid, hid uuid)
language plpgsql stable security definer set search_path = public as $$
declare t text; part uuid[]; ids uuid[] := '{}'; cutoff timestamptz := now() - make_interval(days => days);
begin
  for t in select c.table_name::text from information_schema.columns c
           where c.table_schema = 'public' and c.column_name = 'deleted_at' order by 1 loop
    return query execute format('select %L::text, id, household_id from %I where deleted and deleted_at < $1', t, t) using cutoff;
    execute format('select coalesce(array_agg(id), ''{}'') from %I where deleted and deleted_at < $1', t) into part using cutoff;
    ids := ids || part;
  end loop;
  return query select 'entry_photos'::text, p.id, p.household_id from entry_photos p
    where p.entry_id = any(ids) and not (p.id = any(ids));
end $$;

-- 3. The Storage files of those rows (diary/, recipes/ and extra/ folders, any version).
create or replace function expired_photo_paths(days int default 30) returns setof text
language sql stable security definer set search_path = public, storage as $$
  select o.name from expired_deleted_rows(days) e
  join storage.objects o on o.bucket_id = 'photos'
   and o.name like e.hid::text || '/' || case e.tbl when 'diary_entries' then 'diary' when 'recipes' then 'recipes' else 'extra' end || '/' || e.row_id::text || '%'
  where e.tbl in ('diary_entries', 'recipes', 'entry_photos')
$$;

-- 4. Erase the rows and their edit history. Run after the files are removed.
create or replace function erase_expired_deleted(days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int; total int := 0; hist int := 0;
begin
  for r in select tbl, array_agg(row_id) ids from expired_deleted_rows(days) group by tbl loop
    delete from audit_log where table_name = r.tbl and row_id = any(r.ids);
    get diagnostics n = row_count; hist := hist + n;
    execute format('delete from %I where id = any($1)', r.tbl) using r.ids;
    get diagnostics n = row_count; total := total + n;
  end loop;
  return jsonb_build_object('rows', total, 'history', hist);
end $$;

revoke execute on function expired_deleted_rows(int) from public, anon, authenticated;
revoke execute on function expired_photo_paths(int) from public, anon, authenticated;
revoke execute on function erase_expired_deleted(int) from public, anon, authenticated;
