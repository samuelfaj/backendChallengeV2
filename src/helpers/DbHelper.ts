import { sql } from "drizzle-orm";
import { db } from "../db/client";

export default class DbHelper {
	static async checkConnection() {
		await db.execute(sql`SELECT 1`);
		return { connected: true };
	}
}