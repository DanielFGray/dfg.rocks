# Plan: Make active-student identity explicit across SSR and client state

## Problem Analysis

The active-student context (for parents acting on behalf of children) is inconsistently applied:
- **Query keys** don't include active student ID → cache collisions when switching children
- **SSR loaders** resolve effective student differently from client queries → hydration mismatch
- **Switching students** only invalidates `["auth", "user"]` → stale data in other queries
- **Booking state** not reset when student changes → wrong student booked

## Files Modified

1. **`app/lib/queries.ts`** - Core query key definitions and switch helper ✅
2. **`app/routes/_authed/dashboard.tsx`** - SSR loader alignment ✅
3. **`app/routes/_authed/messages.tsx`** - Query key usage ✅
4. **`app/routes/_authed/book-lesson.tsx`** - Reset booking state on student switch ✅
5. **`app/routes/_authed/courses.index.tsx`** - Query key usage ✅
6. **`app/components/dashboard/StudentDashboard.tsx`** - Query key usage ✅
7. **`app/routes/_authed/assignments.index.tsx`** - Query invalidation fix ✅
8. **`app/routes/_authed/my-lessons.tsx`** - SSR loader filter ✅
9. **`e2e/active-student.spec.ts`** - Parity tests ✅

## Implementation Completed

### 1. Created effective student ID selector for query keys ✅
Added `getEffectiveStudentId()` helper that reads from auth query cache and returns the student ID to use for query keys.

### 2. Updated all student-dependent query keys to include active student ID ✅
- `messagesQuery(studentId?)` → `["messages", studentId]`
- `assignmentsQuery(studentId?)` → `["assignments", studentId]`
- `practiceLogsQuery(studentId?)` → `["practice-logs", studentId]`
- `coursesQuery(studentId?)` → `["courses", studentId]`
- `scheduledLessonsQuery(studentId?)` → `["my-lessons", "scheduled", studentId]`
- `myLessonsQuery(studentId?)` → `["my-lessons", studentId]`
- `myLessonNotesQuery(studentId?)` → `["my-lesson-notes", studentId]`
- `availableSlotsQuery(date, studentId?)` → `["available-slots", date, studentId]`

### 3. Created `invalidateStudentQueries()` helper ✅
Single function that invalidates all student-dependent query keys for a given student ID (or all if none provided).

### 4. Enhanced `useSwitchActiveStudent()` to call `invalidateStudentQueries()` ✅
After successful switch, invalidates all student-dependent queries for the new student.

### 5. Updated SSR loaders to use same effective student resolution ✅
Ensured `dashboard.tsx`, `messages.tsx`, `courses.index.tsx`, `my-lessons.tsx` loaders use `resolveEffectiveStudent` consistently.

### 6. Updated `book-lesson.tsx` to reset state on student change ✅
Added useEffect to clear `selectedStudentId`, `bookingSlot` when `activeStudentId` changes.

### 7. Fixed query invalidation in assignments.index.tsx ✅
Changed to use `exact: false` to match new query key structure.

### 8. Added parity tests (E2E) ✅
Created `e2e/active-student.spec.ts` testing switching between two children covering:
- Dashboard data
- Courses page
- Messages page
- Practice logs
- Booking state reset

## Query Key Schema

```
["auth", "user"]                              // Auth state (includes activeStudentId)
["messages", studentId?]                      // Messages for student (null = current user)
["assignments", studentId?]                   // Assignments for student
["practice-logs", studentId?]                 // Practice logs for student
["courses", studentId?]                       // Courses for student
["my-lessons", "scheduled", studentId?]       // Scheduled lessons
["my-lessons", studentId?]                    // All lessons
["my-lesson-notes", studentId?]               // Lesson notes
["available-slots", date, studentId?]         // Available slots (optional student filter)
```

Note: `studentId` is `undefined` for non-parents (acts as self), or the active student ID for parents.

## Verification

- ✅ Build passes (`bun run build`)
- ✅ TypeScript typecheck passes for modified files
- ✅ Lint passes
- ✅ E2E test file created (requires database to run)