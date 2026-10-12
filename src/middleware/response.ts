import type { Request, Response, NextFunction } from "express";

const responseMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.success = (message = "", data: unknown = null, status = 200) => {
    return res.status(status).json({
      success: true,
      status,
      message,
      data,
    });
  };

  next();
};

export default responseMiddleware;
