# dfg.rocks Backend & Student Portal

## Overview

A Bun + Effect-TS backend for dfg.rocks that handles contact form submissions, an admin dashboard, and a student portal with structured curriculum. The Astro marketing site remains static — the backend is a separate service on the same VPS.

## Goals

1. Contact form on the marketing site actually works — submissions stored in Postgres, admin notified via email
2. Admin dashboard to manage submissions, students, curriculum, and materials
3. Student portal where students log in and access their enrolled courses plus a shared library
4. Dogfood fibrae as the frontend framework for the portal SPA

## Stack

- **Runtime:** Bun
- **Backend:** Effect-TS with `@effect/platform` HttpApi (same patterns as postgres.garden)
- **Database:** PostgreSQL with Graphile Migrate, RLS, multi-role security
- **Sessions:** Valkey (Redis-compatible) + Postgres dual-layer
- **Frontend:** Fibrae SPA (client-side routing, SSR hydration)
- **File storage:** Local filesystem behind API
- **Notifications:** Resend (transactional email, free tier)
- **Deployment:** Docker Compose, Caddy reverse proxy
- **Reference implementation:** `/home/dan/build/postgres.garden/`

## User Roles

- **Anonymous** — can submit contact form
- **Student** — logs in, sees enrolled courses + shared library + direct assignments
- **Admin** — manages everything: submissions, students, curriculum, materials

Student accounts are invite-only. Admin creates the account, student receives an invite link to set their password.

## Data Model

### Contact Submissions

```
contact_submissions
├── id (UUID, PK)
├── name (text)
├── email (text)
├── phone (text, nullable)
├── instrument (text)
├── format (text)
├── message (text)
├── is_read (boolean, default false)
├── created_at (timestamptz)
```

No auth required to submit. Admin views and manages these from the dashboard.

### Users & Auth

```
users
├── id (UUID, PK)
├── username (citext, unique)
├── name (text)
├── email (citext, unique)
├── role (enum: admin, student)
├── created_at (timestamptz)
├── updated_at (timestamptz)

user_secrets (app_private schema)
├── user_id (UUID, PK, FK → users)
├── password_hash (text)
├── invite_token (text, nullable)
├── invite_token_expires_at (timestamptz, nullable)
├── reset_password_token (text, nullable)
├── reset_password_token_expires_at (timestamptz, nullable)

sessions (app_private schema)
├── id (UUID, PK)
├── user_id (FK → users)
├── created_at (timestamptz)
├── expires_at (timestamptz)
```

Session validation follows postgres.garden's dual-layer pattern: secret hash stored only in Valkey for fast lookups, Postgres stores session metadata for persistence/audit. HttpOnly cookie, SameSite=lax, 30-day TTL. State-mutating endpoints require `X-Requested-With` header as CSRF mitigation.

### Curriculum

```
courses
├── id (UUID, PK)
├── title (text)
├── description (text)
├── instrument (text)
├── created_at (timestamptz)
├── updated_at (timestamptz)

modules
├── id (UUID, PK)
├── course_id (FK → courses)
├── title (text)
├── description (text, nullable)
├── sort_order (integer)

materials
├── id (UUID, PK)
├── title (text)
├── original_filename (text)
├── file_path (text)
├── mime_type (text)
├── file_size (bigint)
├── is_global (boolean, default false)
├── uploaded_by (FK → users)
├── created_at (timestamptz)

module_materials
├── module_id (FK → modules)
├── material_id (FK → materials)
├── sort_order (integer)
├── PK (module_id, material_id)
```

### Student Enrollment & Assignments

```
enrollments
├── student_id (FK → users)
├── course_id (FK → courses)
├── enrolled_at (timestamptz)
├── PK (student_id, course_id)

student_materials
├── student_id (FK → users)
├── material_id (FK → materials)
├── assigned_at (timestamptz)
├── PK (student_id, material_id)
```

A student sees:
1. Enrolled courses → modules → materials (structured curriculum)
2. Directly-assigned materials (one-off, ad-hoc)
3. Global library (materials where `is_global = true`)

## API

### Public (no auth)

- `GET /api/health` — health check for Docker/monitoring
- `POST /api/contact` — submit contact form, triggers email notification via Resend. Honeypot field + Caddy rate limit for spam protection.

### Auth

- `POST /api/login` — email + password → session cookie
- `POST /api/logout` — clear session
- `POST /api/set-password` — invite token + new password (onboarding flow)
- `POST /api/forgot-password` — send reset email
- `POST /api/reset-password` — reset token + new password

### Authenticated (any role)

- `GET /api/me` — current user profile + role (determines frontend routing)
- `GET /api/courses` — enrolled courses
- `GET /api/courses/:id` — course with modules and materials
- `GET /api/materials/:id/download` — download a file
- `GET /api/library` — global materials
- `GET /api/assignments` — directly-assigned materials

### Admin

- `GET /api/admin/submissions` — list contact submissions
- `PATCH /api/admin/submissions/:id` — mark read/unread
- `POST /api/admin/students` — create student account (sends invite email)
- `GET /api/admin/students` — list students
- `GET /api/admin/courses` — list all courses
- `GET /api/admin/courses/:id` — course detail with modules
- `POST /api/admin/courses` — create course
- `PATCH /api/admin/courses/:id` — update course
- `DELETE /api/admin/courses/:id` — delete course
- `GET /api/admin/courses/:courseId/modules` — list modules in course
- `POST /api/admin/courses/:courseId/modules` — create module
- `PATCH /api/admin/modules/:id` — update module
- `DELETE /api/admin/modules/:id` — delete module
- `POST /api/admin/materials/upload` — upload file
- `DELETE /api/admin/materials/:id` — remove material
- `POST /api/admin/modules/:id/materials` — attach material to module
- `DELETE /api/admin/modules/:moduleId/materials/:materialId` — detach
- `POST /api/admin/students/:id/enroll` — enroll in course
- `DELETE /api/admin/students/:id/enroll/:courseId` — unenroll
- `POST /api/admin/students/:id/assign` — assign one-off material
- `DELETE /api/admin/students/:id/assign/:materialId` — unassign

## Frontend

Fibrae SPA with client-side routing. The backend serves a static HTML shell; the SPA fetches data client-side after mount via the API. No per-request SSR — auth state is resolved client-side from `GET /api/me`.

Two main views:

### Student View
- Login page
- Dashboard: list of enrolled courses, recent assignments
- Course view: modules as expandable sections, materials with download links
- Library: browsable global materials
- Set password page (invite flow)

### Admin View
- Submissions inbox (list with read/unread, click to expand)
- Student management (list, create, view enrollments)
- Curriculum builder (courses → modules → drag/attach materials)
- Material upload (drag-and-drop, metadata editing)

### Marketing Site Integration
The Astro site's contact form POSTs to `POST /api/contact` on this backend. CORS configured to allow the marketing site's origin. The form on the Astro site gets re-added with the proper action URL once the backend is live.

## Notification

Contact form submissions trigger an email to the admin via Resend API. Done inline on submission — no job queue needed at this volume. If volume grows or latency matters, move to Graphile Worker.

## File Storage

Materials stored on local filesystem at a configurable path (e.g. `/data/dfg-materials/`). Files named by UUID to avoid collisions. Original filename stored in `materials.original_filename` for `Content-Disposition` headers; `title` is an editable display name. The download endpoint streams the file with proper Content-Type, Content-Length, and Content-Disposition headers.

Docker volume mount exposes the storage path to the container.

## Security

- PostgreSQL RLS: students can only see their own enrollments, assignments, and global materials
- Three-tier role system (owner, authenticator, visitor) matching postgres.garden
- Admin endpoints gated by role check in Effect HttpApi middleware
- File downloads gated by enrollment/assignment check — no direct filesystem access
- Spam protection: honeypot field on contact form + Caddy rate limiting per IP
- Rate limiting on login endpoint via Caddy
- CSRF: `X-Requested-With` header required on state-mutating endpoints
- Invite and reset tokens are single-use with expiration

## Deployment

- Docker Compose with dedicated Postgres and Valkey instances (separate from postgres.garden for isolation)
- Caddy reverse proxy with automatic TLS
- Astro marketing site served as static files (built separately, served by Caddy)
- `GET /api/health` for Docker health checks

List endpoints support `?offset=N&limit=N` query params for pagination.
