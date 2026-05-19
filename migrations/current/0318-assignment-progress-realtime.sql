create trigger _900_rt after insert or update or delete on app_public.assignment_progress
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentProgressChanged', 'rt:assignment_progress', 'student_id'
  );

create trigger _900_rt after insert or update or delete on app_public.assignment_reviews
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentReviewChanged', 'rt:assignment_reviews', 'student_id'
  );
