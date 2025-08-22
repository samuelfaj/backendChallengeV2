import type { Response } from "express";
import { z } from "zod";

export default class ApiHelper {
	static OK = 200;
	static CREATED = 201;
	static NO_CONTENT = 204;
	static BAD_REQUEST = 400;
	static UNAUTHORIZED = 401;
	static NOT_FOUND = 404;
	static INTERNAL_SERVER_ERROR = 500;

	private code: number | null = null;
	constructor(private readonly res: Response) {}

	setCode(code: number) {
		this.code = code;
		return this;
	}

	success(data: any) {
		this.res
			.status(this.code ?? ApiHelper.OK)
			.json(data);
	}

	error(error: Error | z.ZodError, data: any = null) {
		if (error instanceof z.ZodError) {
			this.res
				.status(this.code ?? ApiHelper.BAD_REQUEST)
				.json({
					error: "Validation error",
					details: error.issues.map(issue => ({
						field: issue.path.join('.'),
						message: issue.message,
						code: issue.code
					})),
					data,
				});
		} else {
			this.res
				.status(this.code ?? ApiHelper.INTERNAL_SERVER_ERROR)
				.json({
					error: error.message || "Internal server error",
					data,
				});
		}
	}
}