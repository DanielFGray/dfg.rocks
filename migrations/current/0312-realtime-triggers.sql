-- Realtime triggers: fire pg_notify on changes to app_public tables.
-- The realtimeService LISTENs on fixed channels and fans out via Valkey pub/sub.
-- Subject column values are included in the JSON payload for user resolution.

-- === messages ===
create trigger _900_rt_sender after insert or update or delete on app_public.messages
  for each row execute procedure app_public.tg__graphql_subscription(
    'messageChanged', 'rt:messages', 'sender_id'
  );
create trigger _901_rt_recipient after insert or update or delete on app_public.messages
  for each row execute procedure app_public.tg__graphql_subscription(
    'messageChanged', 'rt:messages', 'recipient_id'
  );

-- === lessons ===
create trigger _900_rt after insert or update or delete on app_public.lessons
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonChanged', 'rt:lessons', 'student_id'
  );

-- === courses ===
create trigger _900_rt after insert or update or delete on app_public.courses
  for each row execute procedure app_public.tg__graphql_subscription(
    'courseChanged', 'rt:courses', 'id'
  );

-- === modules ===
create trigger _900_rt after insert or update or delete on app_public.modules
  for each row execute procedure app_public.tg__graphql_subscription(
    'moduleChanged', 'rt:modules', 'course_id'
  );

-- === materials ===
create trigger _900_rt after insert or update or delete on app_public.materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'materialChanged', 'rt:materials', 'id'
  );

-- === student_materials ===
create trigger _900_rt after insert or update or delete on app_public.student_materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'studentMaterialChanged', 'rt:student_materials', 'student_id'
  );

-- === module_materials ===
create trigger _900_rt after insert or update or delete on app_public.module_materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'moduleMaterialChanged', 'rt:module_materials', 'module_id'
  );

-- === enrollments ===
create trigger _900_rt after insert or update or delete on app_public.enrollments
  for each row execute procedure app_public.tg__graphql_subscription(
    'enrollmentChanged', 'rt:enrollments', 'student_id'
  );

-- === family_memberships ===
create trigger _900_rt after insert or update or delete on app_public.family_memberships
  for each row execute procedure app_public.tg__graphql_subscription(
    'familyMembershipChanged', 'rt:family_memberships', 'user_id'
  );

-- === lesson_notes ===
create trigger _900_rt after insert or update or delete on app_public.lesson_notes
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonNoteChanged', 'rt:lesson_notes', 'lesson_id'
  );

-- === practice_logs ===
create trigger _900_rt after insert or update or delete on app_public.practice_logs
  for each row execute procedure app_public.tg__graphql_subscription(
    'practiceLogChanged', 'rt:practice_logs', 'student_id'
  );

-- === assignment_notes ===
create trigger _900_rt after insert or update or delete on app_public.assignment_notes
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentNoteChanged', 'rt:assignment_notes', 'student_id'
  );

-- === lesson_deposits ===
create trigger _900_rt after insert or update or delete on app_public.lesson_deposits
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonDepositChanged', 'rt:lesson_deposits', 'lesson_id'
  );
