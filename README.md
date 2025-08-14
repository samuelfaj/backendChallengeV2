# backendChallengeV2
# Empath Take-Home: Course Assignment & Progress Tracking Redesign

**Timebox:** 2 hours (stop there even if incomplete)  
**Stack:** Node.js (TS or JS), DynamoDB Local. No deploy required.  
**Focus:** Data modeling, backend API design, migration planning, and practical handling of watch tracking.

---

## Background

Today when a user is assigned a course:

- We create one **UserCourse**, a **UserLesson** for each lesson, and then many **UserLessonProgress** rows every few seconds while the lesson plays.  
- Seeking ahead is restricted off those fine-grained progress points.  
- Re-takes (annual reups) require unassign → reassign, which loses history.  
- Watching while **not assigned** isn’t tracked toward the course, which skews real watch-time.  
- **Current API** is GraphQL (AppSync/Amplify), and we’d like to keep it if practical — but we are not married to it. If you propose something else (REST, hybrid, etc.), justify why.

You’ll propose a new structure that solves these problems, plus minimal endpoints the frontend would need to write/read data. Keep it open-ended and focus on sound reasoning.

---

## Current Schema (simplified, auth removed)

```graphql
type UserCourse @model @searchable {
  id: ID!
  course: Course @hasOne
  userCourseCourseId: ID!
    @index(
      name: "listUserCoursesByCourseId"
      queryField: "listUserCoursesByCourseId"
      sortKeyFields: ["createdAt"]
    )
  userLessons: [UserLesson] @hasMany
  userQuizes: [UserQuizes] @hasMany
  user: String
  dueDate: AWSDateTime
  dateStarted: AWSDateTime
  dateCompleted: AWSDateTime
  dateLastViewed: AWSDateTime
  status: String
  lastCompletedDate: AWSDateTime
}

enum UserLessonStatus {
  Assigned
  InProgress
  Completed
}

type UserLesson @model @searchable {
  id: ID!
  lesson: Lesson @hasOne
  progress: [UserLessonProgress] @hasMany
  status: UserLessonStatus
  user: UserProfile @hasOne
  dateStarted: AWSDateTime
  dateCompleted: AWSDateTime
  dateLastViewed: AWSDateTime
  maxProgress: Int
}

type UserLessonProgress @model @searchable {
  id: ID!
  progress: Float!
  owner: String
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime
}

```


The Challenge
-------------

Propose a **new data structure**, a **minimal set of frontend-facing endpoints** (your choice), and a **migration approach** that:

1.  Supports re-takes (annual reups) without losing a user’s history.
    
2.  Tracks viewing even when the user is **not assigned**, so prior watch can be credited later.
    
3.  **Seek behavior requirement (clarified):**
    
    *   If a user is **unassigned** and seeks past their highest verified progress, capture that as a **skip event** (or equivalent) so managers/admins can see the lesson wasn’t watched end-to-end.
        
    *   If a user is **assigned**, you may limit seeking or record a similar flag — your call — but describe the UX and data you’d store to support it.
        
4.  Records **playback speed** for watched segments (.5× to 2×) so we can see which sections were watched at which speed, and compute both:
    
    *   **Effective watch time** (adjusted by speed)
        
    *   **Coverage** (which raw seconds on the timeline were actually observed)
        
5.  Minimizes write amplification versus the per-second model.
    
6.  Avoids table scans for hot paths.
    
7.  **Handles session interruptions:** If a user leaves the app or navigates between lessons/progress updates, your approach should capture progress with **minimal time missed** in tracking.
    

Keep it open-ended — show your thinking.

What to Deliver
---------------

*   **Proposed data model**
    
    *   Can be DynamoDB or another AWS-managed service (RDS, Aurora, etc.) if you think it’s a better fit.
        
    *   If you propose a different storage layer, justify why in terms of **cost**, **performance**, **geographic replication**, and **development complexity**.
        
    *   Define keys and any indexes for your chosen approach, and explain how they serve the access patterns.
        
*   **Frontend-facing endpoints (outline only)**
    
    *   Describe the endpoints the frontend would need to **write** (e.g., watch heartbeats/segments, seek attempts, enroll/reup) and **read** (attempt status, lesson coverage, reports).
        
    *   Define input/output shapes at a high level.
        
    *   You may keep these as GraphQL operations or propose a different API style if you believe it’s better — but explain why.
        
*   **Seek, speed & interruption handling (approach)**
    
    *   How you represent watched **segments** and **speed** per segment.
        
    *   How you decide if a seek should be allowed, flagged, or merely recorded when unassigned.
        
    *   How you compute **effective time** vs **coverage** without per-second rows.
        
    *   How your design ensures **minimal progress loss** when a user leaves or navigates mid-lesson.
        
    *   Concurrency considerations (avoid races, idempotency).
        
*   **Migration plan**
    
    *   Safe path from the current model: dual-writes/backfill/cutover/rollback at a high level.
        
    *   How to credit prior unassigned watch to a later assignment (e.g., windowing rules, caps).
        
*   **Trade-offs**
    
    *   Storage vs. compute, write reduction vs. reconstruction cost, index/query design, and any compromises.
        

Constraints & Expectations
--------------------------

*   Default assumption: DynamoDB (NoSQL).
    
*   Current API: GraphQL — we’d like to keep it if practical, but open to other API approaches with justification.
    
*   Alternate AWS-managed storage is acceptable with **clear justification** and trade-off analysis (cost, speed, replication).
    
*   Idempotency for client retries (e.g., heartbeats).
    
*   Consider TTL for stale granular artifacts if you aggregate elsewhere.
    
*   Keep your solution comprehensible; avoid heavyweight frameworks.
    

Anti-AI “Show Your Work” (lightweight guardrails)
-------------------------------------------------

*   Keep a short **build journal** (timestamps, decisions, dead-ends) in your README.
    
*   Make **3–6 small commits** with meaningful messages.
    
*   Add a per-candidate **SEED\_WORD** (we’ll provide) into sample data or ids.
    
*   If you used AI for a snippet, note where and why. We care more about your design than boilerplate.
