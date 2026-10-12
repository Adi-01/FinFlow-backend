import type { Request, Response, NextFunction } from "express";
import { registerUser, loginUser } from "@/services/auth.service.js";

export const registerController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await registerUser(req.body);
    return res.success("User registered successfully.", result, 201);
  } catch (error) {
    next(error);
  }
};

export const loginController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await loginUser(req.body);
    return res.success("Login successful.", result, 200);
  } catch (error) {
    next(error);
  }
};

