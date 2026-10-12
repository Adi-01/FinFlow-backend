import express from "express";
import requestIdMiddleware from "@/middleware/requestId.js";
import responseMiddleware from "@/middleware/response.js";
import requestLogger from "@/middleware/requestLogger.js";
import { generalRateLimiter } from "@/middleware/rateLimiter.js";
import authRoutes from "@/routes/auth.routes.js";
import userRoutes from "@/routes/user.routes.js";
import allowanceRoutes from "@/routes/allowance.routes.js";
import incomeRoutes from "@/routes/income.routes.js";
import expenseRoutes from "@/routes/expense.routes.js";
import dashboardRoutes from "@/routes/dashboard.routes.js";
import transactionRoutes from "@/routes/transaction.routes.js";
import categoryRoutes from "@/routes/category.routes.js";
import paymentMethodRoutes from "@/routes/paymentMethod.routes.js";
import reflectRoutes from "@/routes/reflect.routes.js";
import profileRoutes from "@/routes/profile.routes.js";
import { errorHandler } from "@/middleware/errorHandler.js";
import { BASE_ROUTES } from "@/lib/routes.js";

const app = express();

app.use(express.json());
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(responseMiddleware);
app.use(generalRateLimiter);

app.get("/", (req, res) => {
  return res.success("API is working!");
});

app.get("/health", (req, res) => {
  return res.success("Health check passed", {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use(BASE_ROUTES.authBaseRoute, authRoutes);
app.use(BASE_ROUTES.usersBaseRoute, userRoutes);
app.use(BASE_ROUTES.profileBaseRoute, profileRoutes);
app.use(BASE_ROUTES.allowanceBaseRoute, allowanceRoutes);
app.use(BASE_ROUTES.incomeBaseRoute, incomeRoutes);
app.use(BASE_ROUTES.expenseBaseRoute, expenseRoutes);
app.use(BASE_ROUTES.dashboardBaseRoute, dashboardRoutes);
app.use(BASE_ROUTES.transactionsBaseRoute, transactionRoutes);
app.use(BASE_ROUTES.categoriesBaseRoute, categoryRoutes);
app.use(BASE_ROUTES.paymentMethodsBaseRoute, paymentMethodRoutes);
app.use(BASE_ROUTES.reflectBaseRoute, reflectRoutes);

app.use(errorHandler);

export default app;

