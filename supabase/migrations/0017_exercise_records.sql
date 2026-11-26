-- Therapy home exercises (File -> Therapy) are records of kind 'exercise'.
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (kind in
  ('condition', 'allergy', 'medication', 'directive', 'contact', 'lab', 'visit', 'document', 'update', 'event', 'dose', 'plan', 'exercise'));
