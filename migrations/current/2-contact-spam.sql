-- Why a contact submission counts as spam. Null for a real inquiry. A spam row sends no
-- notification email, and the admin inbox leaves it out unless asked.

alter table app_public.contact_submissions add column if not exists spam_reason text;

comment on column app_public.contact_submissions.spam_reason is
  'Why the submission counts as spam, such as proxy (an anonymizing proxy in a datacenter); null for a real inquiry.';
