-- A lesson can produce at most one single-booking bill line. The row lock in
-- 0337 serializes normal retries; this invariant also protects direct SQL and
-- future callers from duplicate obligations.

create unique index if not exists bill_line_items_single_booking_lesson
  on app_public.bill_line_items(lesson_id)
  where line_type = 'single_booking' and lesson_id is not null;
