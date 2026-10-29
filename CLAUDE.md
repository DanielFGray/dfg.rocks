# dfg.rocks

Music lessons business site + student/admin portal. React + TanStack Start frontend, Effect HttpApi backend (in-process), PostgreSQL with RLS enforcement.

## Commands

```bash
bun run dev              # Start all services (app, typecheck, worker)
bun run dev:app          # Vite + TanStack Start dev server (port 3000)
bun run typecheck        # tsc --noEmit -p tsconfig.app.json
bun run db:up            # Start the shared ops cluster and write DB URLs to .env
bun run db:setup         # db:up, then db:reset
bun run db:reset         # Re-provision dfg_rocks through ops, then db:latest
bun run db:latest        # Install the worker schema, apply committed and current/ migrations
bun run gm <command>     # graphile-migrate with .env loaded
bun run db:types         # Regenerate Kysely types from DB schema
bun run test:e2e         # Playwright E2E tests
```

## Local database

Local Postgres is the shared cluster from `ops dev db` (container `ops-dev-pg17`, 127.0.0.1:5417), declared by `cartridge.json`. `ops dev db up` creates `dfg_rocks`, `dfg_rocks_shadow` and `dfg_rocks_test` with the same roles and extensions as production, and writes `DATABASE_URL`, `AUTH_DATABASE_URL`, `SHADOW_DATABASE_URL` and `TEST_DATABASE_URL` to `.env`. It writes no root URL. Unit, worker and E2E tests use `dfg_rocks_test` through `scripts/testDatabase.ts`, which resets it with `ops dev db reset`. `bun -b` does not load `.env`, so scripts that run a binary pass `--env-file=.env`.

## Deploy

Production runs on the server-ansible platform (`~/build/server-ansible`), described by `cartridge.json`. `ops release` builds the Dockerfile from committed HEAD, so the image never sees `.env` or `generated/`. Traefik ends TLS and sets `X-Real-Ip`, the only client-address header the rate limiter trusts. The platform creates `dfg_rocks_owner` and `dfg_rocks_visitor` group roles, a migration login in the owner role, and a NOINHERIT API login in the visitor role. The server prestart runs `bun run migrate`, which installs the graphile-worker schema and applies committed migrations.

`server/assertEnv.ts` holds only what the server and worker read at runtime. `scripts/devEnv.ts` adds the admin seed values.

## Architecture

### Single-process: TanStack Start + Effect HttpApi

```
TanStack Start (Vite)
  ├── app/routes/          React pages (file-based routing, SSR)
  └── app/routes/api.$.ts  Catch-all server route → Effect web handler
        └── server/app.ts  Effect HttpApi app with /api/* routes
              ├── server/routes/public.ts
              ├── server/routes/auth.ts
              ├── server/routes/authenticated.ts
              ├── server/routes/admin.ts
              └── server/routes/testing.ts (non-production)
```

No separate API server process. Effect HttpApi runs in-process via TanStack Start's server route handlers.

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

**DB connections** (`server/db.ts`):

- `withAuthContext(sessionId, fn)` — authenticated queries on `PgAuthDB` (RLS enforced via `set_config`)
- `PgRootDB` — auth functions (`app_private.*`), admin DML, cross-user lookups (bypasses RLS)

Both are a `Database`: a Kysely instance that only builds queries. Run a query with `db.execute(builder)`, which returns an Effect of its rows inside the current Effect transaction. Kysely's own `.execute()` throws, so no query runs outside the transaction.

```typescript
// Authenticated handler with RLS:
.get("/courses", ({ auth }) =>
  withAuthContext(auth.session.id, (db) =>
    db.execute(db.selectFrom("app_public.courses").select([...]))
  )
)
```

**Don't filter by user_id in TypeScript** — RLS handles it.

**Effect auth/layer flow**:

- Session validation via `sessionService.validateSessionToken(cookie)`
- Auth guard throws `HttpError(401)` if no session
- Admin guard checks role + CSRF header (`x-requested-with`)

### Database Schema

Three-schema separation:

- `app_public` — user-facing tables with RLS policies
- `app_private` — secrets, sessions, auth functions (SECURITY DEFINER)

RLS policies derive user context from `current_setting('my.session_id')` joined through `app_private.sessions`.

**Adding a new table**: Create in `migrations/current/`, add RLS policies and GRANT to `:DATABASE_VISITOR`, run `graphile-migrate watch --once` to apply.

### Testing

- Rate limiting uses the in-memory limiter only when `NODE_ENV=production`; other environments get `RateLimitService.Test`
- Testing API (`/api/testing/*`) creates users, seeds data, clears state — only loaded when `NODE_ENV !== "production"`
- Playwright fixtures: `testing.login()`, `testing.clear()`, `testing.seedCourse()`, `testing.enroll()`

## RLS & `withAuthContext` Rules

- **All `app_public` queries MUST use `withAuthContext`** so RLS enforces per-row access.
- **Only `app_private` schema operations** (session creation, auth functions, background workers) use `rootDb` directly.
- Even admin CRUD on `app_public` tables goes through `withAuthContext` — RLS confirms admin role via `current_user_role()`.
- **`withAuthContext` callback signature**: `<A, E, R>(sessionId, (db) => Effect<A, E, R>)` — the `<R>` generic allows callbacks with environment requirements (e.g., `fileService.ts` which nests `withAuthContext` calls).
- **Server function payloads**: `createServerFn` return values go through `toServerFunctionPayload` (a JSON round trip) in `app/lib/serverFunctionPayload.ts`.

## Known Issues

### `DeprecationWarning: Calling client.query()` (upstream `@effect/sql-pg`)

Benign warning, no functionality impact.

## Style

### Server

- Effect throughout: handlers and services are Effects, and errors are Schema tagged errors in the error channel. When you touch an async/await handler, convert it.
- Effect HttpApi route groups with shared auth/raw-handler helpers
- Kysely queries run through `withAuthContext`, and PostgreSQL errcodes map to typed HTTP errors

### Client

- React function components with hooks
- TanStack Query for server state, useState for local UI state
- TanStack Router file-based routing with typed routes
- TailwindCSS for styling, `data-testid` attributes for E2E selectors
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
| `app/routes/api.$.ts`                      | Catch-all route mounting the Effect web handler       |
| `app/config.ts`                            | Site metadata (name, city, testimonials, etc.)        |
| `server/app.ts`                            | Effect HttpApi app composition                        |
| `server/db.ts`                             | Database, PgRootDB, PgAuthDB, withAuthContext         |
| `server/routes/public.ts`                  | Public endpoints (health, contact, OAuth)             |
| `server/routes/auth.ts`                    | Auth endpoints (login, logout, me, password)          |
| `server/routes/authenticated.ts`           | Authed endpoints (courses, messages, lessons)         |
| `server/routes/admin.ts`                   | Admin endpoints (CRUD, gcal, settings)                |
| `server/routes/testing.ts`                 | Test data seeding (non-production)                    |
| `server/services/sessionService.ts`        | Session CRUD (PG)                                     |
| `server/services/authService.ts`           | Login, password reset                                 |
| `server/services/googleCalendarService.ts` | Google Calendar integration                           |
| `server/pgErrors.ts`                       | HttpError class, PG errcode mapping                   |
| `migrations/current/`                      | SQL schema (graphile-migrate)                         |

## Rules

- Write migrations in `migrations/current/` as numbered files (`1-schemas.sql`, `2-users.sql`). Graphile Migrate writes `migrations/committed/`. Run `graphile-migrate commit` before a release that needs the change; production applies committed migrations only.
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
