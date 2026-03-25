# dfg.rocks

Music lessons business site + student/admin portal. React + TanStack Start frontend, Elysia API backend (in-process), PostgreSQL with RLS enforcement.

## Commands

```bash
bun run dev              # Start all services (mprocs: app, typecheck, worker)
bun run dev:app          # Vite + TanStack Start dev server (port 5174)
bun run typecheck        # tsgo --noEmit -p tsconfig.app.json
bun run db:setup         # Full DB setup (docker + init + reset + migrate)
bun run db:reset         # Drop and recreate DB, reapply all migrations
bun run db:latest        # Apply committed migrations only
bun -b graphile-migrate watch --once  # Apply current/ migrations
bun run db:types         # Regenerate Kysely types from DB schema
bun run test:e2e         # Playwright E2E tests (18 specs)
```

## Architecture

### Single-process: TanStack Start + Elysia

```
TanStack Start (Vite)
  ├── app/routes/          React pages (file-based routing, SSR)
  └── app/routes/api.$.ts  Catch-all server route → Elysia
        └── server/app.ts  Elysia app with /api/* routes
              ├── server/routes/public.ts
              ├── server/routes/auth.ts
              ├── server/routes/authenticated.ts
              ├── server/routes/admin.ts
              └── server/routes/testing.ts (non-production)
```

No separate API server process. Elysia runs in-process via TanStack Start's server route handlers.

### Client: Typed Fetch API

All API access goes through `app/lib/api.ts`:

```typescript
import { api } from "../lib/api.js";

// In React component with TanStack Query:
const { data: courses } = useSuspenseQuery({ queryKey: ["courses"], queryFn: api.authenticated.courses });

// Mutations:
const mutation = useMutation({ mutationFn: (p) => api.admin.createCourse(p) });
```

**Endpoint groups**: `api.public.*`, `api.auth.*`, `api.authenticated.*`, `api.admin.*`

### Routing: TanStack Start (file-based)

Routes live in `app/routes/`. Auth-guarded routes under `app/routes/_authed/` (layout route with `beforeLoad`, `ssr: false`).

### State Management

- **Server state**: TanStack Query (`useQuery`, `useSuspenseQuery`, `useMutation`)
- **Local UI state**: `useState` (modals, form inputs, toggles)
- **Auth**: `useAuth()` hook backed by `useQuery(["me"])` — returns `{ user, isAdmin }`
- **Data refresh**: `queryClient.invalidateQueries({ queryKey: [...] })`

### Server: Elysia + Kysely + RLS

Backend uses Elysia for routing/middleware, Kysely for type-safe SQL, and PostgreSQL RLS for row-level security.

**DB connections** (`server/db.ts`):
- `authDb` + `withAuthContext(sessionId, fn)` — authenticated queries (RLS enforced via `set_config`)
- `rootDb` — auth functions (`app_private.*`), admin DML, cross-user lookups (bypasses RLS)

```typescript
// Authenticated handler with RLS:
.get("/courses", ({ auth }) =>
  withAuthContext(auth.session.id, (db) =>
    db.selectFrom("app_public.courses").select([...]).execute()
  )
)
```

**Don't filter by user_id in TypeScript** — RLS handles it.

**Elysia middleware** (derive/guard):
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

- Rate limiting disabled via `disableRateLimiting()` in test setup
- Testing API (`/api/testing/*`) creates users, seeds data, clears state — only loaded when `NODE_ENV !== "production"`
- Playwright fixtures: `testing.login()`, `testing.clear()`, `testing.seedCourse()`, `testing.enroll()`

## Style

### Server
- Plain async/await, Kysely queries, throw `HttpError` for errors
- Elysia route groups with derive/guard middleware
- `mapPgError()` for mapping PostgreSQL errcodes to HTTP errors

### Client
- React function components with hooks
- TanStack Query for server state, useState for local UI state
- TanStack Router file-based routing with typed routes
- TailwindCSS for styling, `data-pwid` attributes for E2E selectors

## Key Files

| File | Purpose |
|------|---------|
| `shared/schemas.ts` | Response schemas (UserResponse, CourseResponse, etc.) |
| `app/lib/api.ts` | Typed fetch client (all endpoint wrappers) |
| `app/lib/types.ts` | Type aliases derived from shared schemas |
| `app/lib/hooks/useAuth.ts` | Auth hook (useQuery + isAdmin) |
| `app/routes/__root.tsx` | Root layout (html, head, providers) |
| `app/routes/_authed.tsx` | Auth guard layout route (ssr: false) |
| `app/routes/api.$.ts` | Catch-all route mounting Elysia |
| `app/config.ts` | Site metadata (name, city, testimonials, etc.) |
| `server/app.ts` | Elysia app composition |
| `server/db.ts` | rootDb, authDb, withAuthContext |
| `server/routes/public.ts` | Public endpoints (health, contact, OAuth) |
| `server/routes/auth.ts` | Auth endpoints (login, logout, me, password) |
| `server/routes/authenticated.ts` | Authed endpoints (courses, messages, lessons) |
| `server/routes/admin.ts` | Admin endpoints (CRUD, gcal, settings) |
| `server/routes/testing.ts` | Test data seeding (non-production) |
| `server/services/sessionService.ts` | Session CRUD (Valkey + PG) |
| `server/services/authService.ts` | Login, password reset |
| `server/services/googleCalendarService.ts` | Google Calendar integration |
| `server/pgErrors.ts` | HttpError class, PG errcode mapping |
| `migrations/current/` | SQL schema (graphile-migrate) |
