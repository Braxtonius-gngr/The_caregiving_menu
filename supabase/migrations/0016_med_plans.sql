-- AI-drafted medicine schedules. A plan is a record (kind 'plan') with fields.status
-- draft -> approved / declined. Only an owner may approve or decline (D-021); the app
-- then writes the accepted times onto the medicines, and History keeps the old ones.
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (kind in
  ('condition', 'allergy', 'medication', 'directive', 'contact', 'lab', 'visit', 'document', 'update', 'event', 'dose', 'plan'));

create or replace function guard_plan_approval() returns trigger language plpgsql security definer set search_path = public as $$
declare st text := new.fields->>'status'; was text;
begin
  if new.kind <> 'plan' or auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then was := old.fields->>'status'; end if;
  if st in ('approved', 'declined') and st is distinct from was
     and new.household_id not in (select my_owned_household_ids()) then
    raise exception 'Only an owner of the family can approve or decline a medicine plan';
  end if;
  return new;
end $$;
drop trigger if exists records_plan_guard on records;
create trigger records_plan_guard before insert or update on records for each row execute function guard_plan_approval();
