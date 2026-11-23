# dfg.rocks

Music lessons business site + student/admin portal. React + TanStack Start frontend, Effect HttpApi backend (in-process), PostgreSQL with RLS enforcement.

## Commands

```bash
bun run dev              # Start all services (app, typecheck, worker)
bun run dev:app          # The dev process: Vite in middleware mode, API and job runner (port 3000)
bun run typecheck        # tsc --noEmit -p tsconfig.app.json
bun run db:up            # Start the shared ops cluster and write DB URLs to .env
bun run db:setup         # db:up, then db:reset
bun run db:reset         # Re-provision dfg_rocks_dev through ops, then db:latest
bun run db:latest        # Install the worker schema, apply committed and current/ migrations
bun run gm <command>     # graphile-migrate with .env loaded
bun run db:types         # Regenerate Kysely types from DB schema
bun run test:e2e         # Playwright E2E tests
```

## Local database

Local Postgres is the shared cluster from `ops dev db` (container `ops-dev-pg17`, 127.0.0.1:5417), declared by `cartridge.json`. `ops dev db up` creates `dfg_rocks_dev`, `dfg_rocks_dev_shadow` and `dfg_rocks_dev_test` with the same roles and extensions as production, and writes `DATABASE_URL`, `AUTH_DATABASE_URL`, `SHADOW_DATABASE_URL` and `TEST_DATABASE_URL` to `.env`. It writes no root URL. Every checkout and worktree shares these databases, so `bun run db:reset` resets them for all of them. Each test script runs under `ops dev db test --`, which takes the app's test-database lock, resets the `_test` database and runs the command; a second run waits. `scripts/testDatabase.ts` then applies migrations to the `_test` database. Run one e2e file with `bun run test:e2e <file>`, so it holds the lock. `bun -b` does not load `.env`, so scripts that run a binary pass `--env-file=.env`.

## Deploy and boot

Before you change deployment, configuration or boot, read [docs/design/runtime.md](docs/design/runtime.md).

## Backend reference

The backend follows ~/build/effect-web-template. Before you add or change a
backend pattern (config, HTTP server, database access, errors, sessions, rate
limits, Valkey, realtime, worker, tests), read how the template does it and do
the same. Security code and auth SQL will come from `@danielfgray/stompbox`
(~/build/stompbox); this app does not depend on it yet.

When the template has no pattern for what you need, stop and ask the user
which way to go: prove the pattern in this app and then port it to the
template, or design it in effect-web-template first. Either way, file the
effect-web-template task, and add a `tasks blocks` edge from the task that
comes first to the one that follows.

## Architecture

### Single process: an Effect layer graph

```
server/main.ts (production) / server/dev.ts (development)
  BunRuntime.runMain(Layer.launch(...))
  └── server/shell/      Site: /api/* and /healthz → API; other paths → files, then TanStack Start
        └── server/app.ts  makeApp: services, job runner, /api handler (HttpApiLive)
              ├── server/api/health.ts
              ├── server/api/public.ts
              ├── server/api/auth.ts
              ├── server/api/<feature>.ts  one handler group per feature
              ├── server/api/testing.ts (non-production)
              └── app/        TanStack Start pages; server functions use runServerEffect
```

The shell passes the application's services in TanStack Start's request context, and server functions run on them through `runServerEffect` (`app/lib/serverEffect.ts`). Production loads the application from the bundle. Development loads it through Vite's SSR runner and builds it again after an edit. After an edit to `server/dev.ts` or `server/shell/`, restart the dev process with Ctrl-C.

A server function that stands in for an API endpoint (a form that posts before hydration) calls the API through `InProcessApi.clientFor(getRequest())` (`server/inProcessApi.ts`), so the endpoint's rate limits and checks run. Design: ~/build/effect-web-template/docs/design/in-process-callers.md.

### Client: Typed Fetch API

All API access goes through `app/lib/api.ts`:

```typescript
import { api } from "../lib/api.js";

// In React component with TanStack Query:
const { data: courses } = useSuspenseQuery({
  queryKey: ["courses"],
  queryFn: async () => (await api.courses.get()).data,
});

// Mutations:
const mutation = useMutation({ mutationFn: (p) => api.admin.courses.post(p) });
```

**Endpoint groups**: top-level user routes (`api.courses.*`, `api.messages.*`, etc.) plus `api.admin.*`

### Routing: TanStack Start (file-based)

Routes live in `app/routes/`. Auth-guarded routes under `app/routes/_authed/` (layout route with `beforeLoad`).

### State Management

- **Server state**: TanStack Query (`useQuery`, `useSuspenseQuery`, `useMutation`)
- **Local UI state**: `useState` (modals, form inputs, toggles)
- **Auth**: `useAuth()` hook backed by `useQuery(["me"])` — returns `{ user, isAdmin }`
- **Data refresh**: `queryClient.invalidateQueries({ queryKey: [...] })`

### Server: Effect HttpApi + Kysely + RLS

Backend uses Effect HttpApi for routing/handlers, Kysely for type-safe SQL, and PostgreSQL RLS for row-level security.

**DB connections** (`server/db.ts`, `server/requestDatabase.ts`):

- `RequestDatabase` (`server/requestDatabase.ts`): the visitor connection inside the request's transaction. A service method yields it; its handler pipes the call through `withAuthContext(sessionId)`, which sets the visitor role and session for that transaction, so RLS applies.
- `PgRootDB` — auth functions (`app_private.*`), admin DML, cross-user lookups (bypasses RLS)

Both are a `Database`: a Kysely instance that only builds queries. Run a query with `db.execute(builder)`, which returns an Effect of its rows inside the current Effect transaction. Kysely's own `.execute()` throws, so no query runs outside the transaction.

```typescript
// Service method: queries as the visitor, with RLS
listCourses: Effect.fn("listCourses")(function* () {
  const db = yield* RequestDatabase
  return yield* db.execute(db.selectFrom("app_public.courses").select([...]))
}),

// Handler: one visitor transaction for the call
courses.listCourses().pipe(withAuthContext(auth.session.id))
```

**Don't filter by user_id in TypeScript** — RLS handles it.

**Effect auth/layer flow**:

- Session validation via `sessions.validateSessionToken(cookie)`
- Auth guard throws `HttpError(401)` if no session
- Admin guard checks role + CSRF header (`x-requested-with`)

### Database Schema

Three-schema separation:

- `app_public` — user-facing tables with RLS policies
- `app_hidden` — internal tables; the visitor role has USAGE on it
- `app_private` — secrets, sessions, auth functions (SECURITY DEFINER)

RLS policies derive user context from `current_setting('my.session_id')` joined through `app_private.sessions`.

**Adding a new table**: Create in `migrations/current/`, add RLS policies and GRANT to `:DATABASE_VISITOR`, run `graphile-migrate watch --once` to apply.

### Testing

- Rate limits count in Valkey only when `NODE_ENV=production`; other environments get `RateLimit.layerTest`, which allows every request. `server/rateLimit.ts` holds each rule's limit, window, and what to do when Valkey cannot answer.
- Testing API (`/api/testing/*`) creates users, seeds data, clears state — only loaded when `NODE_ENV !== "production"`
- Playwright fixtures: `testing.login()`, `testing.clear()`, `testing.seedCourse()`, `testing.enroll()`

## RLS & `withAuthContext` Rules

- **All `app_public` queries run as the visitor**: the service yields `RequestDatabase` and the handler pipes the call through `withAuthContext`, so RLS enforces per-row access. One handler call runs in one visitor transaction.
- **No HTTP call runs inside that transaction.** Queue a job; when the visitor role cannot queue it, a row-change trigger does (`app_private.tg_lessons__sync_calendar_event`).
- **Only `app_private` schema operations** (session creation, auth functions, background workers) use `rootDb` directly.
- Even admin CRUD on `app_public` tables goes through `withAuthContext` — RLS confirms admin role via `current_user_role()`.
- **Server function payloads**: a `createServerFn` returns the contract types directly. TanStack Start serializes them with Seroval, so a Date arrives as a Date.

## Known Issues

### `DeprecationWarning: Calling client.query()` (upstream `@effect/sql-pg`)

Benign warning, no functionality impact.

## Style

### Server

- Effect throughout: handlers and services are Effects, and errors are Schema tagged errors in the error channel. When you touch an async/await handler, convert it.
- Effect HttpApi route groups with shared auth/raw-handler helpers
- Kysely queries run as the visitor through `RequestDatabase` and `withAuthContext`, and PostgreSQL errcodes map to typed HTTP errors

### Client

- React function components with hooks
- TanStack Query for server state, useState for local UI state
- TanStack Router file-based routing with typed routes
- TailwindCSS for styling, `data-testid` attributes for E2E selectors
- Write one colour class per property, such as `text-muted`. The colours in `app/styles.css` change in dark mode, so add `dark:` only for a colour that is not one of those tokens, such as `dark:text-red-400`.
- React Aria Components for form inputs (TextField, Input, etc.)

## Key Files

| File                                       | Purpose                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| `shared/schemas.ts`                        | Response schemas (UserResponse, CourseResponse, etc.) |
| `app/lib/api.ts`                           | Typed fetch client (all endpoint wrappers)            |
| `app/lib/types.ts`                         | Type aliases derived from shared schemas              |
| `app/lib/hooks/useAuth.ts`                 | Auth hook (useQuery + isAdmin)                        |
| `app/routes/__root.tsx`                    | Root layout (html, head, providers)                   |
| `app/routes/_authed.tsx`                   | Auth guard layout route                               |
| `app/config.ts`                            | Site metadata (name, city, testimonials, etc.)        |
| `server/main.ts`, `server/dev.ts`          | Process entries (production, development)             |
| `server/shell/`                            | Site: routing, static files, Vite                     |
| `server/app.ts`                            | makeApp: services, job runner, /api handler           |
| `server/runtime.ts`                        | Application layer, AppServices, HttpApiLive           |
| `server/db.ts`                             | Database, PgRootDB, PgAuthDB                          |
| `server/requestDatabase.ts`                | RequestDatabase, withAuthContext                      |
| `server/api/health.ts`                     | GET /healthz (database and worker)                    |
| `server/api/public.ts`                     | Public endpoints (contact, OAuth)                     |
| `server/api/auth.ts`                       | Auth endpoints (login, logout, me, password)          |
| `server/api/<feature>.ts`                  | One handler group per feature                         |
| `server/api/testing.ts`                    | Test data seeding (non-production)                    |
| `server/services/sessions.ts`              | Session CRUD (PG)                                     |
| `server/services/auth.ts`                  | Login, password reset                                 |
| `server/services/googleCalendar.ts`        | Google Calendar integration                           |
| `server/pgErrors.ts`                       | HttpError class, PG errcode mapping                   |
| `migrations/current/`                      | SQL schema (graphile-migrate)                         |

## Rules

- Write migrations in `migrations/current/` as numbered files (`1-schemas.sql`, `2-users.sql`). Each file must run more than once without error (`create or replace`, `drop ... if exists` before `create`, `if not exists`): `graphile-migrate watch` runs it again after each edit, and the commit at release runs it on a database that already has it.
- Release in two steps. Push only when the user asks.
  1. Stage: merge the branch into `develop`, then push `develop` to `origin` and `cynic`. The pre-push hook signs off the tree, and the push to `cynic` deploys the tailnet-only staged copy, whose databases start as copies of production. `ops dash` shows whether it is healthy. Check the change there. The staged copy runs `bun run migrate`, which applies committed migrations only, so it does not have the SQL in `migrations/current/`. Check a schema change on the dev database.
  2. Release: from a clean checkout on `main`, run `ops promote`. It merges `develop`, commits `migrations/current/` into `migrations/committed/` (`build(db): commit migration`) when it holds SQL, signs the tree off and prints the push command. A push of `main` to `cynic` releases. Production applies committed migrations only, and refuses a `main` whose `migrations/current/` still holds SQL.
  3. When the promote committed a migration, fast-forward `develop` to `main` (`git merge --ff-only main` on `develop`). `ops promote` does not move `develop`, which otherwise keeps the committed SQL in `migrations/current/`.

  A branch that reaches `main` without passing through `develop` leaves `develop` behind. Design: `~/build/server-ansible/docs/design/continuous-deployment.md`.
- Write SQL keywords in lowercase (`create table`, `primary key`). Graphile placeholders such as `:DATABASE_VISITOR` stay uppercase.
- When Effect code misbehaves, debug the Effect code.

## RLS Migration Reference

Each `app_public` table needs:

1. `alter table ... enable row level security;`
2. GRANTs to `:DATABASE_VISITOR` for all operations the visitor role might perform
3. RLS policies for each operation (select/insert/update/delete)
4. Admin policies should use `app_public.current_user_role() in ('admin', 'teacher')`

Key GRANT requirements (common pitfalls):

- Tables with `ON CONFLICT DO UPDATE` need `update` GRANT
- Column-level GRANTs like `grant insert (body)` only allow inserting those columns
- GRANTs must be applied even if policies allow the operation (GRANT is checked before RLS)
