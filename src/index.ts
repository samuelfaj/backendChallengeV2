// src/app.ts
import app from "./config/app";
import routes from "./routes";
import DbHelper from "./helpers/DbHelper";

app.use('/', routes);

async function startServer() {
	if (await DbHelper.checkConnection()) {
		console.log("✅ Database connection successful");
	}

	app.listen(process.env.PORT || 3000, () => {
		console.log("Server is running on port 3000");
	});
}

startServer();