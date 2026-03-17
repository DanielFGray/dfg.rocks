# dfg.rocks

Music lessons business site + student/admin portal. Fibrae SPA frontend, Effect HttpApi backend, PostgreSQL with RLS enforcement.

## Commands

```bash
bun run dev              # Start all services (mprocs: server, app, typecheck, worker, devtui)
bun run dev:app          # Vite dev server (port 5174)
bun run dev:server       # Backend server (port 3001)
bun run typecheck        # tsgo --noEmit -p tsconfig.app.json
bun run db:setup         # Full DB setup (docker + init + reset + migrate)
bun run db:reset         # Drop and recreate DB, reapply all migrations
bun run db:latest        # Apply committed migrations only
bun -b graphile-migrate watch --once  # Apply current/ migrations
bun run db:types         # Regenerate Kysely types from DB schema
bun run test:e2e         # Playwright E2E tests (18 specs)
```

## Architecture

### Three Layers

```
src/           Client (Fibrae SPA, Vite, TailwindCSS)
shared/        Shared types (HttpApi contract, middleware tags, schemas)
server/        Server (Effect HttpApi, Bun runtime, PostgreSQL)
```

### Shared Contract Pattern

The HttpApi contract lives in `shared/contract.ts` — imported by both server (for handler implementation) and client (for `AtomHttpApi.Tag` auto-generated client). Middleware type declarations live in `shared/middleware.ts` (no server deps). Only middleware *implementations* live in `server/`.

### Client: DfgApi (AtomHttpApi.Tag)

All API access goes through `DfgApi` in `src/portal/api.ts`:

```typescript
import { DfgApi } from "./api.js";

// In Effect component:
const api = yield* DfgApi;
const courses = yield* api.authenticated.courses({});
const detail = yield* api.authenticated.courseDetail({ path: { id } });
const result = yield* api.admin.createCourse({ payload: { title, instrument } });
```

**Endpoint groups**: `api.public.*`, `api.auth.*`, `api.authenticated.*`, `api.admin.*`

**Calling convention**: Single options object with `path`, `payload`, `urlParams` as needed:
- `api.authenticated.courses({})` — no params
- `api.authenticated.courseDetail({ path: { id } })` — path params
- `api.authenticated.library({ urlParams: { limit: 10 } })` — url params
- `api.admin.createCourse({ payload: { title, instrument } })` — body payload

**File upload** is a standalone function (multipart, can't go through HttpApiClient):
```typescript
import { uploadMaterial } from "./api.js";
```

### Server: RLS Enforcement

Authenticated handlers use `PgAuthDB` + `withAuthContext()` for database-level row security:

```typescript
const { user } = yield* CurrentUser;
const db = yield* PgAuthDB;
return yield* withAuthContext(db, user.id, user.role,
  db.selectFrom("app_public.courses")
    .select(["id", "title", "description", "instrument"])
    .pipe(Effect.orDie),
);
```

`withAuthContext` sets transaction-local PostgreSQL settings (`role`, `my.user_id`, `my.user_role`) so RLS policies enforce access. **Don't filter by user_id in TypeScript** — RLS handles it.

**When to use which DB connection:**
- `PgAuthDB` + `withAuthContext` — authenticated handlers (RLS enforced)
- `PgRootDB` — auth functions (`app_private.*`), admin DML, public inserts (bypasses RLS)

### Database Schema

Three-schema separation:
- `app_public` — user-facing tables with RLS policies
- `app_private` — secrets, sessions, auth functions (SECURITY DEFINER)

RLS policies use `current_setting('my.user_id', true)` and `current_setting('my.user_role', true)`.

**Adding a new table**: Create in `migrations/current/`, add RLS policies and GRANT to `:DATABASE_VISITOR`, run `graphile-migrate watch --once` to apply.

### Account Lockout

`app_private.login()` tracks failed attempts. 3+ failures within 5 minutes raises `LOCKD` errcode, caught as `AccountLockedError` in authService, surfaced as HTTP 423 Locked.

### Testing

- `RateLimiter.Disabled` is provided in the testing API layer (no rate limits during E2E)
- Testing API (`/api/testing/*`) creates users, seeds data, clears state — only loaded when `NODE_ENV !== "production"`
- Playwright fixtures: `testing.login()`, `testing.clear()`, `testing.seedCourse()`, `testing.enroll()`

## Style

- Idiomatic Effect: pipe, Effect.gen, Schema.TaggedError, Context.Tag, Layer
- `Schema.TaggedError` for all errors — never `throw new Error`
- JSX components return `Effect<VElement>` — use `Suspense` for async data
- Event handlers can return Effects (forked by fibrae runtime)
- Atom state: `Atom.make()` at module scope, `registry.get/set` in components
- TailwindCSS for styling, `data-cy` attributes for E2E selectors

## Key Files

| File | Purpose |
|------|---------|
| `shared/contract.ts` | HttpApi definition (groups, endpoints, errors) |
| `shared/middleware.ts` | Middleware Tags (SessionMiddleware, AuthMiddleware, AdminMiddleware) |
| `shared/schemas.ts` | Response schemas (UserResponse, CourseResponse, etc.) |
| `src/portal/api.ts` | `DfgApi` AtomHttpApi.Tag + type aliases |
| `src/app.tsx` | Router, handlers, App component |
| `src/client.tsx` | Browser entry point (render + layer composition) |
| `server/httpapi/server.ts` | All endpoint handler implementations |
| `server/db.ts` | PgRootDB, PgAuthDB, withAuthContext |
| `server/services/authService.ts` | Login, register, password management |
| `server/services/sessionService.ts` | Session creation/validation (Valkey + PG) |
| `server/services/sessionMiddleware.ts` | Middleware Live implementations |
| `migrations/current/` | SQL schema (graphile-migrate) |
