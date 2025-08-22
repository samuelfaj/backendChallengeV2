import { db } from "./client.js";
import { sql } from "drizzle-orm";

export async function checkDatabaseConnection(): Promise<{ connected: boolean; error?: string }> {
	try {
		await db.execute(sql`SELECT 1`);
		return { connected: true };
	} catch (error) {
		return { 
			connected: false, 
			error: error instanceof Error ? error.message : "Unknown database error" 
		};
	}
}