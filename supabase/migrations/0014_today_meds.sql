-- Today screen and daily meds. Two more kinds in the patient file's records table:
--   event: an important day (lab draw, refill, birthday...) shown under "Coming up".
--   dose:  one medicine given / skipped / refused in a time slot of a care day.
--          fields: med_id, day (care day YYYY-MM-DD), slot, status, note.
-- Medicine schedules live in the medication record's fields (slots, with_food, refill_on...).
-- Same RLS, history and Deleted as every other record, so no new table.
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (kind in
  ('condition', 'allergy', 'medication', 'directive', 'contact', 'lab', 'visit', 'document', 'update', 'event', 'dose'));
