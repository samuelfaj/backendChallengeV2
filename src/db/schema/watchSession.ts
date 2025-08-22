import {
	index,
	jsonb,
	pgTable,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const watchSession = pgTable("watch_session", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id").notNull(),
	lessonId: uuid("lesson_id").notNull(),
	lessonAttemptId: uuid("lesson_attempt_id"),
	clientInfo: jsonb("client_info"),
	startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
	lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
	closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => ({
	byAttempt: index("ws_attempt_idx").on(table.lessonAttemptId),
	byUserLesson: index("ws_user_lesson_idx").on(table.userId, table.lessonId, table.startedAt),
}));