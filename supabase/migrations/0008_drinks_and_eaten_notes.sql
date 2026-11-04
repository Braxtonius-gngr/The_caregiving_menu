-- Drinks are their own diary entries, with the amount poured, so fluids can be totalled
-- per person per day ("how much was drunk" is portion_mult). A meal can also carry a note
-- on what was actually eaten ("ate all but half the toast, added 2 salt packets"), used
-- with or without an after photo to recompute the eaten nutrition.
alter table diary_entries add column if not exists entry_kind text not null default 'meal' check (entry_kind in ('meal', 'drink'));
alter table diary_entries add column if not exists volume_ml numeric;
alter table diary_entries add column if not exists eaten_note text;
