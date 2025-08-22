import type { Request, Response } from "express";
import ApiHelper from "../helpers/ApiHelper";

export default class IndexController {
	static index(req: Request, res: Response) {
		new ApiHelper(res).success({
			message: "Hello World",
			date: new Date(),
		});
	}
}