import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const seekEvent = pgTable("seek_event", {
	id: uuid("id").primaryKey().defaultRandom(),
	sessionId: uuid("session_id").notNull(),
	fromSecond: integer("from_second").notNull(),
	toSecond: integer("to_second").notNull(),
	allowed: boolean("allowed").notNull(),
	reason: text("reason").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
	bySession: index("seek_session_idx").on(table.sessionId, table.createdAt),
}));