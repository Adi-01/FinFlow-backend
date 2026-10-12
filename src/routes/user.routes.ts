import { Router } from "express";
import { getMeController } from "@/controllers/user.controller.js";
import { authenticate } from "@/middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);
router.get("/me", getMeController);

export default router;
