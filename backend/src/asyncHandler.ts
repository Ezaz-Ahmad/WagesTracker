import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't catch rejected promises from async route handlers on its own — an
 * awaited db call that throws would otherwise become an unhandled rejection instead of a
 * 500 response. Wrapping handlers with this forwards any rejection to the error-handling
 * middleware in index.ts.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}
