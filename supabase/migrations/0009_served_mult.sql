-- The servings eaten when a meal was marked as partly eaten, kept so a note-only comparison
-- ("ate half") still knows whether one or two servings were served after the multiplier resets.
alter table diary_entries add column if not exists served_mult numeric;
