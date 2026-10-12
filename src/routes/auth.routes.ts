import { Router } from "express";
import {
  registerController,
  loginController,
} from "@/controllers/auth.controller.js";
import {
  registerValidation,
  loginValidation,
} from "@/validators/auth.validator.js";
import { authRateLimiter } from "@/middleware/rateLimiter.js";

const router = Router();

router.use(authRateLimiter);

router.post("/register", registerValidation, registerController);
router.post("/login", loginValidation, loginController);

export default router;
