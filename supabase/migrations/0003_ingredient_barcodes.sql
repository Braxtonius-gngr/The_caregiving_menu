-- An ingredient can be bought under several barcodes (pack sizes, brands).
-- upc keeps the first one; barcodes holds the rest.
alter table ingredients add column if not exists barcodes text[] not null default '{}';
