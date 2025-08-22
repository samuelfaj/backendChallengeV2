import {
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

export const watchSegment = pgTable("watch_segment", {
	id: uuid("id").primaryKey().defaultRandom(),
	sessionId: uuid("session_id").notNull(),
	clientEventId: text("client_event_id").notNull(),
	startSecond: integer("start_second").notNull(),
	endSecond: integer("end_second").notNull(),
	speed: numeric("speed", { precision: 4, scale: 2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
	uniqEvent: unique("ws_session_event_uniq").on(table.sessionId, table.clientEventId),
	bySession: index("ws_session_idx").on(table.sessionId, table.createdAt),
}));