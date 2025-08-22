I strongly believe that better than own the most modern technology we need to think about maintancy.

The best technology with a small number of people that can handle it becomes really expensive and hard to evolve.

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
