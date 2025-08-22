import type { Request, Response } from "express";
import ApiHelper from "../helpers/ApiHelper";
import asyncHandler from "../helpers/AsyncHandler";

export default class IndexController {
	static index = asyncHandler(async (_req: Request, res: Response) => {
		new ApiHelper(res).setCode(ApiHelper.OK).success({
			message: "Hello World",
			date: new Date(),
		});
	});

	static error = asyncHandler(async (_req: Request, res: Response) => {
		throw new Error("test error");

		// eslint-disable-next-line no-unreachable
		new ApiHelper(res).setCode(ApiHelper.OK).success({
			message: "Hello World",
			date: new Date(),
		});
	});
}