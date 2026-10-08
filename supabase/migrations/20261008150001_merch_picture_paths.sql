-- A merch picture or size chart may be an uploaded file (an https address) or a file that ships
-- with the site (/assets/...). The check of 20261006173613 refused '//host' but let '/\host'
-- through, which a browser reads as '//host': another site. Same rule as the events' picture
-- (20261007120001): the character after the first '/' is neither '/' nor '\'.
--
-- Every product on the hosted database passed the new rule when it was written (all four use
-- /assets/ paths), so adding the constraint validates cleanly.

alter table public.merch_products drop constraint if exists merch_products_text_limits;
alter table public.merch_products add constraint merch_products_text_limits check (
  length(tagline) <= 200
  and length(description) <= 2000
  and (image = '' or (length(image) <= 500 and image ~ '^(https://|/[^/\\])[^\s<>"'']*$'))
  and (size_chart = '' or (length(size_chart) <= 500 and size_chart ~ '^(https://|/[^/\\])[^\s<>"'']*$'))
);
