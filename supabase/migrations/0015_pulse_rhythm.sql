-- Pulse and heart rhythm with a blood pressure (or oxygen) reading. Many home BP cuffs show
-- an "irregular heartbeat" or "AFib" symbol; the family marks what the screen showed.
alter table measurements add column if not exists pulse numeric;
alter table measurements add column if not exists rhythm text;
alter table measurements drop constraint if exists measurements_rhythm_check;
alter table measurements add constraint measurements_rhythm_check check (rhythm is null or rhythm in ('regular', 'irregular', 'afib'));
