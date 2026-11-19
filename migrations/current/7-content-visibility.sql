/*
 * Who may read a course and a material is one of three levels, set on the row:
 *   public  any signed-in account, whatever its role (a free account has no role)
 *   global  an admitted account: one whose role is not null
 *   course  only through enrollment, a schedule or a subscription (courses), or through a
 *           module of a readable course or a direct assignment (materials)
 * A course's modules and module_materials follow the course. A material attached to a module
 * of a readable course is readable whatever its own level.
 *
 * can_read_course is the one rule for courses; its policies on courses, modules, module_materials
 * and materials all ask it. materials.is_global becomes materials.visibility (true is 'global',
 * false is 'course'). The free course at the end is seeded with fixed ids that other sites link to.
 *
 * Every statement here reruns safely: `graphile-migrate watch` applies the files after each
 * edit, and the release commit applies them again on a database that already has them.
 */

-- The levels ------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'app_public' and t.typname = 'content_visibility'
  ) then
    create type app_public.content_visibility as enum ('public', 'global', 'course');
  end if;
end;
$$;

comment on type app_public.content_visibility is
  E'Who may read a course or a material: public (any signed-in account), global (an account with a role), course (only through enrollment, a module or an assignment).';

alter table app_public.courses
  add column if not exists visibility app_public.content_visibility not null default 'course';

alter table app_public.materials
  add column if not exists visibility app_public.content_visibility not null default 'course';

-- The old materials policy reads is_global, so it goes before the column does; the policies
-- below recreate it. Once the column is gone the conversion has run, and a rerun skips it.
drop policy if exists select_enrolled on app_public.courses;
drop policy if exists select_via_course on app_public.modules;
drop policy if exists select_via_module on app_public.module_materials;
drop policy if exists select_accessible on app_public.materials;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'app_public' and table_name = 'materials' and column_name = 'is_global'
  ) then
    update app_public.materials
       set visibility = case when is_global then 'global' else 'course' end::app_public.content_visibility;
    alter table app_public.materials drop column is_global;
  end if;
end;
$$;

-- The access rule ------------------------------------------------------------------------

drop function if exists app_public.can_read_course(uuid);

create or replace function app_public.can_read_course(
  p_course_id uuid,
  p_reader_id uuid default app_public.current_user_id()
) returns boolean as $$
  with
  -- The learners a reader sees: the reader, and when the reader is a parent, the students in
  -- every family the parent belongs to. A sibling is not a learner of the reader's enrollment.
  learners as (
    select p_reader_id as user_id
    union
    select fm2.user_id
      from app_public.family_memberships fm1
      join app_public.family_memberships fm2 on fm2.family_id = fm1.family_id
      join app_public.users u on u.id = fm2.user_id
     where fm1.user_id = p_reader_id
       and u.role = 'student'
       and exists (
         select 1 from app_public.users r where r.id = p_reader_id and r.role = 'parent'
       )
  ),
  payers as (
    select p.user_id from app_public.family_payers(p_reader_id) as p(user_id)
  )
  select
    -- Another user's access is reported only to staff and to members of a family the reader
    -- belongs to, so an unrelated account cannot probe it.
    (p_reader_id = app_public.current_user_id()
     or app_public.current_user_role() in ('admin', 'teacher')
     or p_reader_id in (
       select fm.user_id
         from app_public.family_memberships fm
        where fm.family_id in (select app_public.current_user_member_family_ids())
     ))
    and (
      exists (
        select 1 from app_public.users u
         where u.id = p_reader_id and u.role in ('admin', 'teacher')
      )
      -- The course's own level: public needs only a signed-in account, global an admitted one.
      or exists (
        select 1
          from app_public.courses c
          join app_public.users u on u.id = p_reader_id
         where c.id = p_course_id
           and (c.visibility = 'public' or (c.visibility = 'global' and u.role is not null))
      )
      or exists (
        select 1
          from app_public.enrollments e
         where e.course_id = p_course_id
           and e.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.recurring_schedules rs
          join app_public.student_rates sr on sr.id = rs.student_rate_id
         where rs.active
           and rs.starts_on <= (now() at time zone rs.timezone)::date
           and (rs.ends_on is null or rs.ends_on >= (now() at time zone rs.timezone)::date)
           and sr.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.subscriptions s
         where s.payer_id in (select user_id from payers)
           and app_public.subscription_is_live(s.status, s.current_period_end)
      )
    );
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

comment on function app_public.can_read_course(uuid, uuid) is
  E'Whether a reader may read a course and its content. The reader defaults to the current user. True for staff; for any signed-in reader when the course is public, and for an admitted reader (role not null) when it is global; for a reader who is enrolled in the course, or who has an active weekly lesson schedule, where a parent reader counts the schedules and enrollments of the students in their families (any course); or who or whose billing contacts have a live subscription (any course). past_due keeps access while Stripe retries the card. A reader other than the current user is reported only to staff and to members of a family the reader belongs to; otherwise the answer is false. The course-access policies all call this function, so changing who may read a course changes it here.';

-- Whether a course exists, whatever the caller may read. The course page asks it after a
-- locked course answers not-found, so a missing course is not shown as a subscription prompt.
create or replace function app_public.course_exists(p_course_id uuid) returns boolean as $$
  select exists (select 1 from app_public.courses where id = p_course_id);
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

-- Policies: each table asks can_read_course instead of checking enrollments -----------

create policy select_enrolled on app_public.courses for select
  using (app_public.can_read_course(id));

create policy select_via_course on app_public.modules for select
  using (app_public.can_read_course(course_id));

create policy select_via_module on app_public.module_materials for select
  using (
    exists (
      select 1 from app_public.modules m
       where m.id = module_id
         and app_public.can_read_course(m.course_id)
    )
  );

create policy select_accessible on app_public.materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or (visibility = 'public' and app_public.current_user_id() is not null)
    or (visibility = 'global' and app_public.current_user_role() is not null)
    or id in (
      select mm.material_id
        from app_public.module_materials mm
        join app_public.modules m on m.id = mm.module_id
       where app_public.can_read_course(m.course_id)
    )
    or id in (
      select material_id from app_public.student_materials
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

-- The free course ------------------------------------------------------------------------

-- Two posts moved here from dfg.codes, which answers 301 to these ids. "on conflict do nothing"
-- keeps edits made in the admin UI across reruns. A module's content is a TipTap document;
-- an alphaTex node holds the source of a score that gigbag.js draws and plays.

insert into app_public.courses (id, title, description, instrument, visibility)
values (
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Drum rudiments',
  'A free introduction to the rudiments: learn the single stroke, the double stroke and the paradiddle, then permute them into new exercises.',
  'drums',
  'public'
)
on conflict (id) do nothing;

insert into app_public.modules (id, course_id, title, sort_order, content)
values (
  '6e53f13a-30d4-4efa-9113-2460871d29fe',
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Beginning drums',
  0,
  $content${"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a[n unfinished] guide to learning drums"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: Playing drums is great because you can do it anywhere without sticks."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: Percussion is the art of turning noise into music."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: images instead of crude ASCII"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"First Steps"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Strokes"}]},{"type":"paragraph","content":[{"type":"text","text":"Pat your right hand on your right leg and then your left hand on your left leg, for each hit say a syllable of the word \"single\"."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle\nx   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"paragraph","content":[{"type":"text","text":"Now, while keeping the same rhythm, instead of patting each leg once, pat each leg twice and say \"double\" instead of \"single\"."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"dou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x\nR   R   L   L   R   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's try both of those together:"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle dou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x   x   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L   R   R   L   L   R   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"You've now learned two rudiments, the single stroke roll and the double stroke roll."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Paradiddles"}]},{"type":"paragraph","content":[{"type":"text","text":"The next, and arguably most important rudiment to learn, is the paradiddle: it is made of a single and a double."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle dou-ble\nx   x   x   x\nR   L   R   R\nsin-gle dou-ble\nx   x   x   x\nL   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Notice that the second half is the opposite of the first: The first pattern is a single stroke and a double stroke starting with the right hand, the second pattern is a single stroke and a double stroke, but it starts with the left hand."}]},{"type":"paragraph","content":[{"type":"text","text":"This idea of playing a pattern, and then playing it's opposite is a crucial concept in drumming, the second form often called the 'inversion'."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Putting it all together"}]},{"type":"paragraph","content":[{"type":"text","text":"You've now learned three rudiments!"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's try and play four of each of them."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle\nx   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L\n\ndou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x\nR   R   L   L   R   R   L   L\n\nsin-gle dou-ble sin-gle dou-ble\nx   x   x   x   x   x   x   x\nR   L   R   R   L   R   L   L\n\nsin-gle dou-ble sin-gle dou-ble\nx   x   x   x   x   x   x   x\nR   L   R   R   L   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Make sure to keep a consistent rhythm with each hit. Just because you're playing a double, doesn't mean you have to play it twice as fast! Each note should have the same amount of time to \"breathe\" as every other note."}]},{"type":"paragraph","content":[{"type":"text","text":"Once you're comfortable with the mechanics, try playing along to a metronome. If you don't have access to a metronome (or don't want to install one on your phone), find a clock, and use it as your time keeper, start with playing one note per second, then playing two notes per second, and then up to four notes per second."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"After thoughts"}]},{"type":"paragraph","content":[{"type":"text","text":"\"What is this rudiment thing you keep saying?\" you might think."}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"rudiment ["},{"type":"text","text":"roo","marks":[{"type":"bold"}]},{"type":"text","text":"-d"},{"type":"text","text":"uh","marks":[{"type":"italic"}]},{"type":"text","text":"-m"},{"type":"text","text":"uh","marks":[{"type":"italic"}]},{"type":"text","text":" nt] >"},{"type":"hardBreak"},{"type":"text","text":"Usually, rudiments the elements or first principles of a subject: the rudiments of grammar 1540-50; < Latin "},{"type":"text","text":"rudīmentum","marks":[{"type":"italic"}]},{"type":"text","text":" early training, first experience, initial stage, equivalent to "},{"type":"text","text":"rudi(s)","marks":[{"type":"italic"}]},{"type":"text","text":" unformed, rough + "},{"type":"text","text":"-mentum","marks":[{"type":"italic"}]},{"type":"text","text":" -ment ("},{"type":"text","text":"-ī-","marks":[{"type":"italic"}]},{"type":"text","text":" for "},{"type":"text","text":"-i-","marks":[{"type":"italic"}]},{"type":"text","text":" after verbal derivatives) "},{"type":"text","text":"Source: dictionary.com","marks":[{"type":"italic"}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Simply put, they are the building blocks of drumming. You could think of rudiments as words. Each word is made of letters, in this case, we've used only two letters."}]},{"type":"paragraph","content":[{"type":"text","text":"There is a third letter, the "},{"type":"text","text":"flam","marks":[{"type":"italic"}]},{"type":"text","text":":"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"lR\nrL"}]},{"type":"paragraph","content":[{"type":"text","text":"In music theory that small note is called a "},{"type":"text","text":"grace note","marks":[{"type":"italic"}]},{"type":"text","text":". It sounds like a note that happens just before another note, often played slightly quieter. These three letters make up everything you will find in the world of percussion, they are the alphabet of drumming, and rudiments are the vocabulary a drummer speaks."}]}]}$content$::jsonb
)
on conflict (id) do nothing;

insert into app_public.modules (id, course_id, title, sort_order, content)
values (
  'b2868acb-0716-4805-b2a1-c30c910ba38a',
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Rudimental permutations',
  1,
  $content${"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This post is still a work in progress, so bare with me please. If you spot any errors or have something you want to add, feel free to leave a comment below."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Displacing Accents"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's begin with some simple exercises and warm-ups, using basic rudiments and moving the placement of an accent note forward by one note."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Strokes"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Single Strokes\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit |\nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Double Strokes\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit |\nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Paradiddles"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Paradiddles\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit | \nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"paragraph","content":[{"type":"text","text":"I've heard this concept also called practicing \"grids\", but there's a mathematical term for this, called "},{"type":"text","text":"permutations","marks":[{"type":"italic"}]},{"type":"text","text":"."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Permutations"}]},{"type":"paragraph","content":[{"type":"text","text":"Wikipedia has a page on permutations, the introduction right now says:"}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\"In mathematics, the notion of permutation relates to the act of arranging all the members of a set into some sequence or order, or if the set is already ordered, rearranging (reordering) its elements, a process called permuting.\""}]}]},{"type":"paragraph","content":[{"type":"text","text":"It then goes on to describe it's relation to set theory and computer algorithm sorting, and then a lot of math."}]},{"type":"paragraph","content":[{"type":"text","text":"Permutations are somewhat of an umbrella term for many ideas."}]},{"type":"paragraph","content":[{"type":"text","text":"Anagrams are a common form of permutations: \"now\", \"own\", and \"won\" use the same set of letters without repeating or missing any."}]},{"type":"paragraph","content":[{"type":"text","text":"This is contrast from combinations, where you can repeat or remove items from a set."}]},{"type":"paragraph","content":[{"type":"text","text":"Musical modes are another example of permutations: the steps in the major scale could be expressed as \"WWHWWWH\". The Dorian mode is \"WHWWWHW\", which was made by taking the first \"W\" and moving it to the end. All seven modes of the major scale are as follows:"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Ionian    WWHWWWH\nDorian     WHWWWHW\nPhrygian    HWWWHWW\nLydian       WWWHWWH\nMixolydian    WWHWWHW\nAeolian        WHWWHWW\nLocrian         HWWHWWW"}]},{"type":"paragraph","content":[{"type":"text","text":"I'm going to exclusively be talking about "},{"type":"text","text":"cyclic permutations","marks":[{"type":"italic"}]},{"type":"text","text":", which is what musical modes are, as opposed to unordered permutations, like anagrams. We'll look at rudiments and try to make variations of them by shifting the order around."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Permuting the Single Paradiddle"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 1\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-R-L-R-L-L-R-L-R-R-L-R-L-L-"}]},{"type":"paragraph","content":[{"type":"text","text":"Now let's take that first R and move it to the end of the pattern"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 2\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-R-L-R-L-L-R-L-R-R-L-R-L-L-R-"}]},{"type":"paragraph","content":[{"type":"text","text":"and continue the process"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 3\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-R-L-R-L-L-R-L-R-R-L-R-L-L-R-L-\n\nFig. 4\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-L-L-R-L-R-R-L-R-L-L-R-L-R-\n\nFig. 5\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-L-L-R-L-R-R-L-R-L-L-R-L-R-R-\n\nFig. 6\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-L-R-L-R-R-L-R-L-L-R-L-R-R-L-\n\nFig. 7\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-L-R-L-R-R-L-R-L-L-R-L-R-R-L-R-\n\nFig. 8\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-L-R-R-L-R-L-L-R-L-R-R-L-R-L-"}]},{"type":"paragraph","content":[{"type":"text","text":"Now, start displacing the accents over the permuted rudiments!"}]},{"type":"horizontalRule"},{"type":"paragraph","content":[{"type":"text","text":"If we analyze these patterns, we can group them into four variations"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"ABAA/BABB - figs. 1 and 5\nABBA/BAAB - figs. 2 and 6\nAABA/BBAB - figs. 3 and 7\nABAB/BABA - figs. 4 and 8"}]},{"type":"paragraph","content":[{"type":"text","text":"I prefer this form of \"A/B\" notation over \"R/L\" because it forces me to think more about how to apply it."}]},{"type":"paragraph","content":[{"type":"text","text":"It could be starting with my dominant hand, or it could be the inversion."}]},{"type":"paragraph","content":[{"type":"text","text":"I might not even play it with my hands, maybe I'll play it with my feet, or between the bass and snare drums."}]},{"type":"paragraph","content":[{"type":"text","text":"In fact, you can take just about any pattern apply it six different ways:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both hands: right-hand + left-hand"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both feet: right-foot + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both rights: right-hand + right-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both lefts: left-hand + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"diagonally one way: right-hand + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"diagonally the other way: left-hand + right-foot"}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Now try and play the four variations (and their inversions) across all six limb-combinations!"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Permuting the double paradiddle"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-R-R-L-R-L-R-L-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-R-L-R-L-R-L-L-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-R-L-R-L-R-L-L-R-L-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-R-L-L-R-L-R-L-R-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-L-R-L-R-L-R-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-L-R-L-R-L-R-R-L-R-L-"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"More exercises"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single-stroked Hertas in three"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nRLR-L-RLR-L-RLR-L-RLR-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-RLR-L-RLR-L-RLR-L-RL\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-LRL-R-LRL-R-LRL-R-LRL-"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double-stroked Hertas in three"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nRRL-R-LLR-L-RRL-R-LLR-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nL-R-LLR-L-RRL-R-LLR-L-RR\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-LLR-L-RRL-R-LLR-L-RRL-"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single-stroked Hertas in four"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nRLR-L-R-LRL-R-L-RLR-L-R-LRL-R-L-\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-LRL-R-L-RLR-L-R-LRL-R-L-RL\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-LRL-R-L-RLR-L-R-LRL-R-L-RLR-\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-LRL-R-L-RLR-L-R-LRL-R-L-RLR-L-"}]}]}$content$::jsonb
)
on conflict (id) do nothing;
