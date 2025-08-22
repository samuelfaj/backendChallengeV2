import type { Response } from "express";

export default class ApiHelper {
	static HTTP_STATUS_CODE = {
		OK: 200,
		CREATED: 201,
		NO_CONTENT: 204,
		BAD_REQUEST: 400,
		UNAUTHORIZED: 401,
		NOT_FOUND: 404,
		INTERNAL_SERVER_ERROR: 500,
	}

	private code: number | null = null;
	constructor(private readonly res: Response) {}

	success(data: any) {
		this.res
			.status(this.code ?? ApiHelper.HTTP_STATUS_CODE.OK)
			.json(data);
	}

	error(error: Error, data: any = null) {
		this.res
			.status(this.code ?? ApiHelper.HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR)
			.json({
				error: error.message || "Internal server error",
				data,
			});
	}
}