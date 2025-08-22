// src/app.ts
import app from "./config/app";
import routes from "./routes";
import DbHelper from "./helpers/DbHelper";
import type { Request, Response } from "express";
import { z } from "zod";
import ApiHelper from "./helpers/ApiHelper";

app.use('/', routes);

// Global error handler
app.use((error: Error | z.ZodError, _req: Request, res: Response) => (new ApiHelper(res)).error(error));

async function startServer() {
	if (await DbHelper.checkConnection()) {
		console.log("✅ Database connection successful");
	}

	app.listen(process.env.PORT || 3000, () => {
		console.log("Server is running on port 3000");
	});
}

startServer();