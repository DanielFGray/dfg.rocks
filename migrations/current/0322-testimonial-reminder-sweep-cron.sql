delete from graphile_worker._private_jobs as jobs
using graphile_worker._private_tasks as tasks
where tasks.id = jobs.task_id
  and tasks.identifier = 'testimonials__reminder_sweep'
  and jobs.locked_at is null;
