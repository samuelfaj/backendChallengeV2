import {
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

export const lessonAttempt = pgTable("lesson_attempt", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id").notNull(),
	lessonId: uuid("lesson_id").notNull(),
	userCourseAttemptId: uuid("user_course_attempt_id"),
	attemptNo: integer("attempt_no").notNull().default(1),
	status: text("status").notNull().default("InProgress"),
	maxVerifiedSecond: integer("max_verified_second").notNull().default(0),
	totalEffectiveSeconds: numeric("total_effective_seconds", { precision: 12, scale: 3 }).notNull().default("0"),
	coverageSeconds: integer("coverage_seconds").notNull().default(0),
	flags: jsonb("flags").notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
	byUserLesson: index("la_user_lesson_idx").on(table.userId, table.lessonId),
	byAttemptLink: index("la_attempt_link_idx").on(table.userCourseAttemptId),
	uniq: unique("la_user_lesson_attemptno").on(table.userId, table.lessonId, table.attemptNo),
}));