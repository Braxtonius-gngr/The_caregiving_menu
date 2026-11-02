-- Diary photos now live in the private `photos` Storage bucket (photo_path).
-- The base64 copy is kept on each device only and is never pushed, so the
-- column is unused. Dropping it keeps rows small.
alter table diary_entries drop column if exists photo_data;
