import { Router } from "express";
import { authenticate } from "@/middleware/auth.middleware.js";
import { validateRequest } from "@/middleware/validate.middleware.js";
import {
  changePasswordSchema,
  exportDataQuerySchema,
  deleteAccountSchema,
  revokeSessionParamsSchema,
  updateProfileSchema,
} from "@/validators/profile.validator.js";
import {
  getProfileController,
  updateProfileController,
  uploadAvatarController,
  removeAvatarController,
} from "@/controllers/profile.controller.js";
import {
  accountExportRateLimiter,
  changePasswordRateLimiter,
  deleteAccountRateLimiter,
  avatarUploadRateLimiter,
} from "@/middleware/rateLimiter.js";
import { uploadAvatarMiddleware } from "@/middleware/upload.middleware.js";
import {
  changePasswordController,
  getSessionsController,
  revokeSessionController,
  revokeOtherSessionsController,
  exportUserDataController,
  deleteAccountController,
} from "@/controllers/account.controller.js";

const router = Router();

router.use(authenticate);

router.get("/", getProfileController);
router.patch(
  "/",
  validateRequest({ body: updateProfileSchema }),
  updateProfileController,
);

// Profile Avatar Endpoints
router.patch(
  "/avatar",
  uploadAvatarMiddleware,
  avatarUploadRateLimiter,
  uploadAvatarController,
);

router.delete(
  "/avatar",
  removeAvatarController,
);

// Account Management Endpoints
router.post(
  "/account/change-password",
  changePasswordRateLimiter,
  validateRequest({ body: changePasswordSchema }),
  changePasswordController,
);

router.get(
  "/account/export",
  accountExportRateLimiter,
  validateRequest({ query: exportDataQuerySchema }),
  exportUserDataController,
);

router.get(
  "/account/sessions",
  getSessionsController,
);

router.delete(
  "/account/sessions/:sessionId",
  validateRequest({ params: revokeSessionParamsSchema }),
  revokeSessionController,
);

router.delete(
  "/account/sessions",
  revokeOtherSessionsController,
);

router.delete(
  "/account",
  deleteAccountRateLimiter,
  validateRequest({ body: deleteAccountSchema }),
  deleteAccountController,
);

export default router;
