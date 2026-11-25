-- Each time she does a therapy exercise, the family taps Done on Today: a record of kind 'exercise_log'.
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (kind in
  ('condition', 'allergy', 'medication', 'directive', 'contact', 'lab', 'visit', 'document', 'update', 'event', 'dose', 'plan', 'exercise', 'exercise_log'));
