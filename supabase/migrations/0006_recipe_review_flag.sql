-- Batch photo import saves every recipe straight away. Ones the reader was unsure about
-- (hard to read, possibly missing a page, combined from several photos) carry the reason
-- here until someone checks them. Null means nothing to check.
alter table recipes add column if not exists review_flag text;
