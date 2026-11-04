-- Before/after meal photos. A diary entry can hold a second photo of the plate after the
-- meal (Storage path, same private bucket), whether the plate was finished or had leftovers,
-- and the calories that were served, so "served ~X, ate ~Y" can be shown. The entry's own
-- nutrition is what was actually eaten.
alter table diary_entries add column if not exists after_photo_path text;
alter table diary_entries add column if not exists plate_status text check (plate_status in ('finished', 'leftovers'));
alter table diary_entries add column if not exists served_kcal numeric;
