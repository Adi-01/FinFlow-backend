import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { sseSyncController } from "@/controllers/sync.controller.js";

const router = Router();

router.get("/", authenticate, sseSyncController);

export default router;

