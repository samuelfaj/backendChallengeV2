import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const userCourseAttempt = pgTable("user_course_attempt", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id").notNull(),
	courseId: uuid("course_id").notNull(),
	reupNo: integer("reup_no").notNull().default(1),
	dueDate: timestamp("due_date", { withTimezone: true }),
	status: text("status").notNull().default("Assigned"),
	startedAt: timestamp("started_at", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
}, (table) => ({
	byUserCourse: index("uca_user_course_idx").on(table.userId, table.courseId),
}));