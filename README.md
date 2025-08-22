I strongly believe that, more important than owning the most modern technology, is thinking about maintainability.

The best technology, if only a few people can handle it, becomes very expensive and hard to evolve.

The key adopted here is: simplicity.

## Why PostgreSQL instead of DynamoDB
- **Relational aggregation fit**: Computing coverage, effective time, and reconciling attempts involves joins, ordering, and window-like operations that are natural in SQL and less ergonomic/costly in DynamoDB.
- **Consistency & transactions**: ACID transactions across multiple tables (attempt/session/segment/seek) simplify correctness for idempotency, reconciliation, and cutovers.
- **Operational simplicity**: It's easy to find developers who can work with Postgres, it's simpler and requires less design effort.
- **Cost & performance**: For typical training workloads with moderate write throughput and heavy read/reporting, a single regional Postgres with read replicas is cost-effective. Indexes avoid scans and keep p95 low. Partitioning by time or lesson can extend headroom when needed.
- **Analytics**: SQL makes downstream reporting simpler without copying to a separate store prematurely.

If global low-latency multi-region writes or extreme write volumes are core needs, DynamoDB can be considered, but would require careful key design, streams-based aggregation, and more bespoke reporting flows. Given current requirements and code, PostgreSQL is the pragmatic choice.

Errors in DynamoDB design are expensive and REALLY REALLY hard to revert (you can't do a simple UPDATE).

## API Style Justification

**Choice: REST over GraphQL**

It was the faster choice to develop the test and:

- **Simplicity**: REST endpoints are easier to cache, monitor, and debug
- **Real-time Requirements**: Video progress tracking needs predictable latency; GraphQL resolver overhead adds unnecessary complexity
- **Bulk Operations**: REST better supports efficient batch operations for offline sync
- **Caching**: HTTP caching strategies work naturally with REST endpoints

### Endpoints

- `POST /video/sessions`
  - Body: `{ userId, lessonId, isAssigned?, clientInfo? }`
  - Returns: `{ sessionId, attemptId, message }`
  - Behavior: Ensures an active `lesson_attempt` exists (creating if needed), then starts a session.

- `POST /video/sessions/:sessionId/progress`
  - Body: `{ segments?: WatchSegment[], seeks?: SeekEvent[] }`
  - `WatchSegment`: `{ clientEventId, startSecond, endSecond, speed }`
  - `SeekEvent`: `{ fromSecond, toSecond, allowed?, reason? }`
  - Idempotency: `(sessionId, clientEventId)` uniqueness prevents duplicate segment writes.

- `PUT /video/sessions/:sessionId/heartbeat`
  - Body: none
  - Updates `last_heartbeat_at` to limit missed time on interruption.

- `PUT /video/sessions/:sessionId/close`
  - Body: none
  - Marks session closed and triggers aggregation onto the linked `lesson_attempt`.

- `PUT /video/attempts/:attemptId/complete`
  - Marks an attempt complete.

- `GET /video/users/:userId/lessons/:lessonId/progress`
  - Returns latest attempt, recent sessions, and aggregates.

- `GET /video/users/:userId/unassigned-history`
  - Lists unassigned attempts/sessions for later crediting.

- `GET /video/sessions/:sessionId/skip-analytics`
  - Returns skip events summary.

GraphQL alternative: The same operations can be expressed as mutations/queries. REST is retained here for operational simplicity and Cloud Run friendliness (low cold-start overhead, minimal middleware).

### Session Interruption Handling

1. **Heartbeat Mechanism**: Frontend sends heartbeat every 30 seconds
2. **Graceful Degradation**: If heartbeat fails, client buffers segments locally
3. **Reconnection Logic**: On reconnect, client sends buffered segments via bulk endpoint
4. **Stale Session Detection**: Server marks sessions stale after 5 minutes without heartbeat
5. **Progress Preservation**: All segment data persisted immediately, aggregation happens on session close

## Seek, Speed, and Interruption Handling

- **Watched Segments**: The client posts consolidated segments (e.g., every 5–15 seconds or on pause/seek). Each segment carries `speed`. Aggregation computes:
  - Effective time: `sum((end - start) / speed)`
  - Coverage: merge overlapping intervals to compute unique seconds observed.

- **Seek Behavior**:
  - Unassigned users: seeking past the highest verified progress is recorded as a `seek_event` with `allowed=false`. The service marks it `is_skip` when the jump exceeds a threshold (e.g., >5s). This provides managers visibility that the lesson was not watched linearly.
  - Assigned users: policy choice — either block seeks client-side beyond `maxVerifiedSecond` or allow and mark `allowed=false` with reason (e.g., `policy_violation`). Both are supported; UX is configurable.

- **Interruptions**:
  - Heartbeat updates `last_heartbeat_at` frequently (e.g., every 15–30s). On tab close or network loss, the last beat bounds missed time.
  - Idempotent segment writes ensure retries don’t duplicate data.
  - Closing a session triggers aggregation so progress is not lost if users navigate away.

- **Avoid Per-Second Writes**: Segments are time-ranged events; this keeps write rates low and storage compact while still reconstructing coverage precisely.


## Concurrency & Idempotency

- `watch_segment.uniq(session_id, client_event_id)` eliminates duplicates on client retries.
- Aggregation runs on session close; if run multiple times, it upserts totals at the attempt level deterministically.
- Use simple transactional updates per request, keeping write units small and avoiding long locks.

## Migration Plan (Safe Path)

1. **Dual-write (if needed)**: Keep existing per-second or legacy tracking, while writing to the new `watch_segment`/`seek_event` model.
2. **Backfill**: Translate historical events into segments by coalescing contiguous seconds and deriving seeks from gaps/jumps.
3. **Cutover**: Switch read paths (progress pages, reports) to use `lesson_attempt` aggregates derived from segments.
4. **Rollback**: Toggle reads back to legacy tables if needed; dual-writes maintain consistency during the window.
5. **TTL/Archival**: Optionally archive raw `watch_segment`/`seek_event` older than N days after aggregates are materialized, or partition by month for cheaper retention and faster pruning.

### Crediting Unassigned Watch Later
- When a user becomes assigned for a lesson within a policy window (e.g., last 12 months), reconcile prior unassigned `watch_session`s for the same `(user, lesson)`:
  - Create or update the current `lesson_attempt` with merged coverage and effective time from qualifying sessions.
  - Cap credited coverage to the lesson duration and policy limits.
  - Mark contributing sessions/segments with a `credited_attempt_id` (additional nullable column) if auditability is required.

## Access Patterns and Indexing

- Start/read latest attempt: `lesson_attempt` indexed by `(user_id, lesson_id)` and ordered by `attempt_no DESC`.
- Append progress: `watch_segment` lookup by `session_id` plus unique `(session_id, client_event_id)` for idempotency.
- Skip analytics: `seek_event` by `(session_id, is_skip)` avoids scans.
- Session history: `watch_session` by `(lesson_attempt_id)` or `(user_id, lesson_id, started_at)` for recent lists.

These indexes match the hot paths and keep queries selective, avoiding table scans.

## Tests

✅ 84 tests across 3 files

```
bun test v1.2.8 (adab0f64)

src/controllers/IndexController.test.ts:
✓ IndexController > Controller Structure > should have index method [0.72ms]
✓ IndexController > Controller Structure > should have error method
✓ IndexController > Controller Structure > should export a class with static methods [0.29ms]
✓ IndexController > API Response Structure Testing > should test expected response format for index endpoint [1.03ms]
✓ IndexController > API Response Structure Testing > should validate message content [0.05ms]
✓ IndexController > API Response Structure Testing > should validate date object creation [0.45ms]
✓ IndexController > HTTP Status Code Constants > should use correct HTTP status codes
✓ IndexController > HTTP Status Code Constants > should test index endpoint uses OK status
✓ IndexController > Error Handling Behavior > should test error creation [0.16ms]
✓ IndexController > Error Handling Behavior > should test error throwing mechanism [0.23ms]
✓ IndexController > Error Handling Behavior > should validate error message content
✓ IndexController > Method Signature Validation > should accept standard Express parameters [0.01ms]
✓ IndexController > Method Signature Validation > should validate Request object structure [0.02ms]
✓ IndexController > Method Signature Validation > should validate Response object structure [0.02ms]
✓ IndexController > AsyncHandler Integration > should test that methods are wrapped functions [0.01ms]
✓ IndexController > AsyncHandler Integration > should test function properties [0.02ms]
✓ IndexController > Data Flow Testing > should test response data creation flow [0.18ms]
✓ IndexController > Data Flow Testing > should test date generation timing [0.02ms]
✓ IndexController > Data Flow Testing > should test object property assignment [0.02ms]
✓ IndexController > Code Quality Testing > should test string constants
✓ IndexController > Code Quality Testing > should test unreachable code logic [0.03ms]
✓ IndexController > Code Quality Testing > should test method chaining pattern [0.03ms]
✓ IndexController > Business Logic Validation > should test successful endpoint behavior expectations [0.06ms]
✓ IndexController > Business Logic Validation > should test error endpoint behavior expectations [0.01ms]
✓ IndexController > Business Logic Validation > should test endpoint differences [0.02ms]

src/controllers/VideoProgressController.test.ts:
✓ VideoProgressController > Input Validation > should validate startSession input with missing userId [1.99ms]
✓ VideoProgressController > Input Validation > should validate recordProgress input with invalid segment data [0.98ms]
✓ VideoProgressController > Input Validation > should validate bulkProgress input with empty sessions array [0.08ms]
✓ VideoProgressController > Schema Validation > should accept valid startSession data [0.57ms]
✓ VideoProgressController > Schema Validation > should accept valid recordProgress data [0.42ms]
✓ VideoProgressController > Schema Validation > should use default values correctly [0.34ms]
✓ VideoProgressController > Parameter Validation > should validate sessionId parameter [0.24ms]
✓ VideoProgressController > Parameter Validation > should validate attemptId parameter [0.21ms]
✓ VideoProgressController > Parameter Validation > should validate userId and lessonId parameters [0.23ms]
✓ VideoProgressController > Data Transformation > should transform segment data correctly [0.02ms]
✓ VideoProgressController > Data Transformation > should transform seek data correctly [0.01ms]
✓ VideoProgressController > Data Transformation > should apply default values for missing fields [0.21ms]
✓ VideoProgressController > Business Logic > should handle session start flow [0.03ms]
✓ VideoProgressController > Business Logic > should handle bulk progress processing logic
✓ VideoProgressController > Business Logic > should handle error result structure
✓ VideoProgressController > Business Logic > should handle success result structure
✓ VideoProgressController > API Response Formats > should format startSession response correctly [0.03ms]
✓ VideoProgressController > API Response Formats > should format progress response correctly
✓ VideoProgressController > API Response Formats > should format unassigned history response correctly [0.02ms]
✓ VideoProgressController > API Response Formats > should format bulk progress response correctly [0.02ms]

src/services/VideoProgressService.test.ts:
✓ VideoProgressService > startSession > should create a new session and return session ID [0.40ms]
✓ VideoProgressService > startSession > should handle session creation without lessonAttemptId [0.06ms]
✓ VideoProgressService > startSession > should handle session creation without clientInfo [0.03ms]
✓ VideoProgressService > recordWatchSegment > should record a watch segment with correct data [0.04ms]
✓ VideoProgressService > recordWatchSegment > should handle duplicate segments gracefully [0.03ms]
✓ VideoProgressService > recordWatchSegment > should handle segments with fractional speeds [0.02ms]
✓ VideoProgressService > recordSeekEvent > should record a seek event and detect skips correctly [0.03ms]
✓ VideoProgressService > recordSeekEvent > should not mark small seeks as skips [0.03ms]
✓ VideoProgressService > recordSeekEvent > should handle allowed seeks [0.03ms]
✓ VideoProgressService > recordSeekEvent > should handle backward seeks [0.02ms]
✓ VideoProgressService > updateSessionHeartbeat > should update session heartbeat timestamp [0.03ms]
✓ VideoProgressService > closeSession > should close session and trigger progress calculation [0.60ms]
✓ VideoProgressService > getLessonProgress > should return lesson progress for existing attempt [0.22ms]
✓ VideoProgressService > getLessonProgress > should return null for non-existent lesson [0.07ms]
✓ VideoProgressService > getOrCreateLessonAttempt > should return existing active attempt [0.19ms]
✓ VideoProgressService > getOrCreateLessonAttempt > should create new attempt when none exists [0.18ms]
✓ VideoProgressService > getOrCreateLessonAttempt > should create first attempt when no previous attempts exist [0.19ms]
✓ VideoProgressService > markLessonComplete > should mark lesson attempt as completed [0.04ms]
✓ VideoProgressService > getUnassignedViewingHistory > should return unassigned viewing history [0.10ms]
✓ VideoProgressService > getUnassignedViewingHistory > should return empty array when no unassigned history exists [0.06ms]
✓ VideoProgressService > getSkipAnalytics > should return skip analytics for session [0.16ms]
✓ VideoProgressService > getSkipAnalytics > should return empty analytics when no skips exist [0.08ms]
✓ VideoProgressService > calculateProgressFromSegments > should calculate progress correctly from segments [0.24ms]
✓ VideoProgressService > calculateProgressFromSegments > should handle overlapping segments correctly [0.03ms]
✓ VideoProgressService > calculateProgressFromSegments > should handle empty segments [0.02ms]
✓ VideoProgressService > calculateCoverageFromIntervals > should calculate coverage from non-overlapping intervals [0.02ms]
✓ VideoProgressService > calculateCoverageFromIntervals > should calculate coverage from overlapping intervals [0.01ms]
✓ VideoProgressService > calculateCoverageFromIntervals > should handle single interval [0.02ms]
✓ VideoProgressService > calculateCoverageFromIntervals > should handle empty intervals
✓ VideoProgressService > calculateCoverageFromIntervals > should handle complex overlapping patterns
✓ VideoProgressService > Error Handling > should handle database errors gracefully [0.09ms]
✓ VideoProgressService > Error Handling > should handle invalid speed values [0.04ms]
✓ VideoProgressService > Error Handling > should handle negative time values [0.03ms]
✓ VideoProgressService > Edge Cases > should handle very high playback speeds [0.03ms]
✓ VideoProgressService > Edge Cases > should handle very low playback speeds [0.02ms]
✓ VideoProgressService > Edge Cases > should handle long video segments [0.03ms]
✓ VideoProgressService > Edge Cases > should handle many overlapping intervals efficiently [0.05ms]
✓ VideoProgressService > Performance Edge Cases > should handle large number of segments [0.43ms]
✓ VideoProgressService > Performance Edge Cases > should handle segments with microsecond precision [0.16ms]

 84 pass
 0 fail
 164 expect() calls
Ran 84 tests across 3 files. [151.00ms]
```