import {
	index,
	integer,
	pgTable,
	uuid,
} from "drizzle-orm/pg-core";

export const lessonCoverageInterval = pgTable("lesson_coverage_interval", {
	id: uuid("id").primaryKey().defaultRandom(),
	lessonAttemptId: uuid("lesson_attempt_id").notNull(),
	startSecond: integer("start_second").notNull(),
	endSecond: integer("end_second").notNull(),
}, (table) => ({
	byAttemptStart: index("lci_attempt_start_idx").on(table.lessonAttemptId, table.startSecond),
}));