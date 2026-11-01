# Plan: Make active-student identity explicit across SSR and client state

## Problem Analysis

The active-student context (for parents acting on behalf of children) is inconsistently applied:
- **Query keys** don't include active student ID → cache collisions when switching children
- **SSR loaders** resolve effective student differently from client queries → hydration mismatch
- **Switching students** only invalidates `["auth", "user"]` → stale data in other queries
- **Booking state** not reset when student changes → wrong student booked

## Files to Modify

1. **`app/lib/queries.ts`** - Core query key definitions and switch helper
2. **`app/routes/_authed/dashboard.tsx`** - SSR loader alignment
3. **`app/routes/_authed/messages.tsx`** - Query key usage
4. **`app/routes/_authed/book-lesson.tsx`** - Reset booking state on student switch
5. **`app/routes/_authed/courses.index.tsx`** - Query key usage
6. **`app/components/dashboard/StudentDashboard.tsx`** - Query key usage
7. **`app/components/dashboard/ParentDashboard.tsx`** - Use enhanced switch helper

## Implementation Steps

### 1. Create effective student ID selector for query keys
Add `getEffectiveStudentId()` helper that reads from auth query cache and returns the student ID to use for query keys.

### 2. Update all student-dependent query keys to include active student ID
- `messagesQuery` → `["messages", studentId]`
- `assignmentsQuery` → `["assignments", studentId]`
- `practiceLogsQuery` → `["practice-logs", studentId]`
- `coursesQuery` → `["courses", studentId]`
- `scheduledLessonsQuery` → `["my-lessons", "scheduled", studentId]`
- `myLessonsQuery` → `["my-lessons", studentId]`
- `myLessonNotesQuery` → `["my-lesson-notes", studentId]`
- `availableSlotsQuery` → `["available-slots", date, studentId]` (if student-specific)

### 3. Create `invalidateStudentQueries()` helper
Single function that invalidates all student-dependent query keys for a given student ID (or all if none provided).

### 4. Enhance `useSwitchActiveStudent()` to call `invalidateStudentQueries()`
After successful switch, invalidate all student-dependent queries for the new student.

### 5. Update SSR loaders to use same effective student resolution
Ensure `dashboard.tsx` loader and other SSR loaders use `resolveEffectiveStudent` consistently.

### 6. Update `book-lesson.tsx` to reset state on student change
Add effect to clear `selectedStudentId`, `bookingSlot` when `activeStudentId` changes.

### 7. Add parity tests (E2E)
Test switching between two children covers: courses, messages, dashboard, practice, booking.

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