import { prisma } from "@/lib/prisma.js";
import { ai } from "@/lib/gemini.js";
import { getOrComputeAllowanceService } from "@/services/allowance.service.js";
import { NotFoundError } from "@/errors/NotFoundError.js";
import { BadRequestError } from "@/errors/BadRequestError.js";
import { ConflictError } from "@/errors/ConflictError.js";
import { UnprocessableEntityError } from "@/errors/UnprocessableEntityError.js";
import { logger } from "@/lib/logger.js";
import { redis } from "@/lib/redis.js";
import { getRateLimitStatus, refundRateLimit } from "@/middleware/rateLimiter.js";
import { publishSyncEvent } from "@/lib/sync.js";
import {
  reflectReportDataSchema,
  type ReflectReportData,
  type GenerateReflectInput,
  type GetReflectQueryInput,
  type ChatReflectInput,
} from "@/validators/reflect.validator.js";

const MINIMUM_TRANSACTIONS_REQUIRED = 15;

const EMOJI_REGEX = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{1F004}\u{1F0CF}\u{1F200}-\u{1F251}]/gu;

function stripEmojis(text: string): string {
  return text.replace(EMOJI_REGEX, "").trim();
}

function extractAndNormalizeReportJson(rawText: string): unknown {
  let cleaned = rawText.trim();

  // Strip markdown code fences if present (e.g. ```json ... ```)
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If there is surrounding text outside the JSON boundaries
    const firstObj = cleaned.indexOf("{");
    const lastObj = cleaned.lastIndexOf("}");
    const firstArr = cleaned.indexOf("[");
    const lastArr = cleaned.lastIndexOf("]");

    if (firstObj !== -1 && lastObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
      parsed = JSON.parse(cleaned.slice(firstObj, lastObj + 1));
    } else if (firstArr !== -1 && lastArr !== -1) {
      parsed = JSON.parse(cleaned.slice(firstArr, lastArr + 1));
    } else {
      throw new Error("Unable to locate valid JSON boundaries in AI response");
    }
  }

  // If the model wrapped the response in a top-level array, extract the first object
  if (Array.isArray(parsed) && parsed.length > 0) {
    parsed = parsed[0];
  }

  return parsed;
}

const REFLECT_SYSTEM_INSTRUCTION = `You are FinFlow Reflect, an intelligent, empathetic, warm, and non-judgmental AI financial companion.
Your goal is to analyze monthly financial transaction data and craft an encouraging, insightful, and beautifully structured monthly reflection report.

Key Tone & Style Guidelines:
1. Friendly, curious, encouraging, and non-judgmental. Always celebrate wins, small or large.
2. If spending was high or exceeded allowance, never shame or judge. Frame it with curiosity, empathy, and practical, resilient next steps.
3. Spender Personality Archetype: Invent a memorable, dignified money archetype with a punchy title, tagline, and reveal story (e.g., "The Fortress Saver", "The Velocity Spender", "The Focused Optimizer", "The Mindful Builder", "The Dynamic Explorer", "The Daily Ritualist").
4. Strictly text only: DO NOT include any emojis anywhere in your response.
5. Ground all numbers strictly in the provided input data. Do not hallucinate transactions.
6. Section Depth & Quantity (Minimum 4 items each):
   - "spending_habits": MUST provide at least 4 distinct behavioral habit observations (4 to 6 items).
   - "purchases_to_note": MUST provide at least 4 noteworthy purchases or category clusters (4 to 6 items).
   - "ideas_for_next_month": MUST provide at least 4 practical, encouraging ideas (4 to 6 items).
7. Return ONLY a valid top-level JSON object matching the requested schema. DO NOT wrap in an array [ ... ]. No markdown backticks or commentary outside JSON.`;


const CANDIDATE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemma-4-26b-a4b-it",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.7-flash",
  "gemma-4-31b-it",
  "gemini-flash-latest",
];

async function generateContentWithFallback(params: {
  contents: string | Array<{ role: string; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  responseMimeType?: string;
}) {
  let lastError: unknown;
  for (const model of CANDIDATE_MODELS) {
    try {
      const startTime = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents: params.contents as any,
        config: {
          systemInstruction: params.systemInstruction,
          ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
        },
      });
      const elapsedMs = Date.now() - startTime;
      logger.debug(
        `[Reflect AI] Successfully completed request with model "${model}" in ${elapsedMs}ms`,
      );
      // Returns immediately upon first successful model response; does NOT call any other models
      return response;
    } catch (err: unknown) {
      lastError = err;
      logger.warn(`[Reflect AI] Model "${model}" failed or overloaded, trying next fallback...`, {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

export const getReflectReportService = async (
  userId: string,
  input: GetReflectQueryInput,
) => {
  const { year, month } = input;

  const [report, expensesCount, incomesCount, dailyGenStatus, cooldownGenStatus, dailyChatStatus] =
    await Promise.all([
      prisma.reflectReport.findFirst({
        where: {
          userId,
          year,
          month,
          isDeleted: false,
        },
      }),
      prisma.expense.count({
        where: { userId, year, month, isDeleted: false },
      }),
      prisma.income.count({
        where: { userId, year, month, isDeleted: false },
      }),
      getRateLimitStatus("reflect:generate:daily", userId, 5, 24 * 60 * 60),
      getRateLimitStatus("reflect:generate:cooldown", userId, 1, 2 * 60 * 60),
      getRateLimitStatus("reflect:chat:daily", userId, 30, 24 * 60 * 60),
    ]);

  const transactionCount = expensesCount + incomesCount;
  const canGenerate = dailyGenStatus.canProceed && cooldownGenStatus.canProceed;
  const canChat = dailyChatStatus.canProceed;

  const limits = {
    generate: {
      dailyUsed: dailyGenStatus.used,
      dailyLimit: dailyGenStatus.limit,
      dailyRemaining: dailyGenStatus.remaining,
      cooldownRemainingSeconds: cooldownGenStatus.resetSeconds,
      canGenerate,
    },
    chat: {
      dailyUsed: dailyChatStatus.used,
      dailyLimit: dailyChatStatus.limit,
      dailyRemaining: dailyChatStatus.remaining,
      canChat,
    },
  };

  if (!report) {
    return {
      report: null,
      transactionCount,
      limits,
    };
  }

  return {
    report: {
      id: report.id,
      year: report.year,
      month: report.month,
      data: report.data as ReflectReportData,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    },
    transactionCount,
    limits,
  };
};

export const generateReflectReportService = async (
  userId: string,
  input: GenerateReflectInput,
  originClientId?: string,
) => {
  const { year, month, regenerate } = input;

  // Check if existing report exists and regeneration wasn't explicitly requested
  if (!regenerate) {
    const existing = await prisma.reflectReport.findFirst({
      where: {
        userId,
        year,
        month,
        isDeleted: false,
      },
    });

    if (existing) {
      return {
        id: existing.id,
        year: existing.year,
        month: existing.month,
        data: existing.data as ReflectReportData,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        cached: true,
      };
    }
  }

  // 1. Fetch Month Financials
  const [allowanceData, userSettings, incomes, expenses] = await Promise.all([
    getOrComputeAllowanceService(userId, { year, month }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.income.findMany({
      where: { userId, year, month, isDeleted: false },
      orderBy: { date: "asc" },
    }),
    prisma.expense.findMany({
      where: { userId, year, month, isDeleted: false },
      orderBy: { date: "asc" },
    }),
  ]);

  const totalTransactions = incomes.length + expenses.length;

  // 2. Validate Minimum 15 Transactions Threshold
  if (totalTransactions < MINIMUM_TRANSACTIONS_REQUIRED) {
    throw new UnprocessableEntityError({
      code: "INSUFFICIENT_TRANSACTIONS",
      message: `At least ${MINIMUM_TRANSACTIONS_REQUIRED} transactions are required to generate your monthly reflection report (currently ${totalTransactions} logged). Keep logging to unlock your insights!`,
      details: {
        currentCount: totalTransactions,
        requiredCount: MINIMUM_TRANSACTIONS_REQUIRED,
        remaining: MINIMUM_TRANSACTIONS_REQUIRED - totalTransactions,
      },
    });
  }

  // Atomic generation lock to prevent concurrent double generation
  const lockKey = `lock:reflect:${userId}:${year}:${month}`;
  const acquired = await redis.set(lockKey, "1", "EX", 120, "NX");
  if (!acquired) {
    throw new ConflictError({
      code: "REPORT_GENERATION_IN_PROGRESS",
      message: "A reflection report is currently being generated for this month. Please wait a moment.",
    });
  }

  // Notify other tabs that generation has started
  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "REFLECT",
    originClientId,
    status: "GENERATING",
  });

  const startingAllowance = allowanceData.allowance?.amount || 0;
  const totalIncome = incomes.reduce((sum, inc) => sum + inc.amount, 0);
  const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const remainingBalance = startingAllowance + totalIncome - totalSpent;
  const currencySymbol = userSettings?.currencySymbol || "$";

  // Category breakdown
  const categoryMap: Record<string, number> = {};
  expenses.forEach((exp) => {
    categoryMap[exp.category] = (categoryMap[exp.category] || 0) + exp.amount;
  });

  const categoryBreakdown = Object.entries(categoryMap).map(
    ([category, amount]) => ({
      category,
      amount,
      percentage: totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(1) + "%" : "0%",
    }),
  );

  // Income source breakdown
  const sourceMap: Record<string, number> = {};
  incomes.forEach((inc) => {
    sourceMap[inc.source] = (sourceMap[inc.source] || 0) + inc.amount;
  });

  const sourceBreakdown = Object.entries(sourceMap).map(([source, amount]) => ({
    source,
    amount,
  }));

  // Context payload for Gemini prompt
  const analysisContext = {
    monthYear: `${year}-${String(month).padStart(2, "0")}`,
    currencySymbol,
    metrics: {
      startingAllowance,
      totalIncome,
      totalSpent,
      remainingBalance,
      totalTransactions,
      incomeCount: incomes.length,
      expenseCount: expenses.length,
    },
    categoryBreakdown,
    sourceBreakdown,
    transactionsSample: [
      ...expenses.map((e) => ({
        type: "EXPENSE",
        day: new Date(e.date).getUTCDate(),
        amount: e.amount,
        category: e.category,
        paymentMethod: e.paymentMethod,
        description: e.description,
      })),
      ...incomes.map((i) => ({
        type: "INCOME",
        day: new Date(i.date).getUTCDate(),
        amount: i.amount,
        source: i.source,
        paymentMethod: i.paymentMethod,
        notes: i.notes,
      })),
    ],
  };

  const userPrompt = `Here is the financial data for ${analysisContext.monthYear} in currency ${currencySymbol}:
${JSON.stringify(analysisContext, null, 2)}

Generate a structured reflection report strictly conforming to this JSON format (pure text only, NO emojis anywhere).
Ensure "spending_habits", "purchases_to_note", and "ideas_for_next_month" each contain at least 4 detailed items (between 4 and 6 items):
{
  "personality_reveal": {
    "archetype_title": "Archetype title (pure text, no emojis)",
    "tagline": "A punchy, insightful quote (pure text, no emojis)",
    "reveal_text": "A friendly 2-3 sentence paragraph explaining why this personality fits their month"
  },
  "at_a_glance": {
    "starting_allowance": ${startingAllowance},
    "total_spent": ${totalSpent},
    "extra_income": ${totalIncome},
    "remaining_balance": ${remainingBalance},
    "summary_text": "An encouraging 2-3 sentence overview of their net cashflow and financial rhythm this month"
  },
  "where_money_went": {
    "summary": "1-2 sentences introducing their primary spending buckets",
    "breakdown": [
      {
        "category": "Category name",
        "amount": 0,
        "percentage": "0.0%"
      }
    ]
  },
  "spending_habits": [
    {
      "title": "Habit 1 headline",
      "description": "Insightful observation about timing, micro-transactions, or frequency"
    },
    {
      "title": "Habit 2 headline",
      "description": "Another distinct spending habit observation"
    },
    {
      "title": "Habit 3 headline",
      "description": "Another distinct spending habit observation"
    },
    {
      "title": "Habit 4 headline",
      "description": "Another distinct spending habit observation"
    }
  ],
  "purchases_to_note": [
    {
      "title": "Specific transaction 1 note or category cluster",
      "amount": 0,
      "note": "Constructive or celebratory note"
    },
    {
      "title": "Specific transaction 2 note or category cluster",
      "amount": 0,
      "note": "Constructive or celebratory note"
    },
    {
      "title": "Specific transaction 3 note or category cluster",
      "amount": 0,
      "note": "Constructive or celebratory note"
    },
    {
      "title": "Specific transaction 4 note or category cluster",
      "amount": 0,
      "note": "Constructive or celebratory note"
    }
  ],
  "ideas_for_next_month": [
    {
      "title": "Practical recommendation 1 title",
      "action": "Actionable, non-restrictive suggestion"
    },
    {
      "title": "Practical recommendation 2 title",
      "action": "Actionable, non-restrictive suggestion"
    },
    {
      "title": "Practical recommendation 3 title",
      "action": "Actionable, non-restrictive suggestion"
    },
    {
      "title": "Practical recommendation 4 title",
      "action": "Actionable, non-restrictive suggestion"
    }
  ]
}`;

  try {
    const response = await generateContentWithFallback({
      contents: userPrompt,
      systemInstruction: REFLECT_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
    });

    const rawText = response.text || "{}";
    let parsedJson: unknown;

    try {
      parsedJson = extractAndNormalizeReportJson(rawText);
    } catch {
      logger.error("Failed to parse Gemini JSON response for reflect report", {
        rawText,
        userId,
      });
      throw new BadRequestError({
        code: "AI_GENERATION_FAILED",
        message: "Failed to generate structured report. Please try again.",
      });
    }

    const validationResult = reflectReportDataSchema.safeParse(parsedJson);

    if (!validationResult.success) {
      logger.error("Gemini response did not match ReflectReport schema", {
        errors: validationResult.error.format(),
        rawText,
        userId,
      });
      throw new BadRequestError({
        code: "AI_OUTPUT_INVALID",
        message: "Generated report format was invalid. Please try again.",
      });
    }

    const reportData: ReflectReportData = {
      ...validationResult.data,
      personality_reveal: {
        archetype_title: stripEmojis(validationResult.data.personality_reveal.archetype_title),
        tagline: stripEmojis(validationResult.data.personality_reveal.tagline),
        reveal_text: stripEmojis(validationResult.data.personality_reveal.reveal_text),
      },
      transaction_count: totalTransactions,
    };

    // 3. Upsert into Database
    const savedReport = await prisma.reflectReport.upsert({
      where: {
        userId_year_month: {
          userId,
          year,
          month,
        },
      },
      create: {
        userId,
        year,
        month,
        data: reportData,
      },
      update: {
        data: reportData,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      },
    });

    await publishSyncEvent(userId, {
      type: "INVALIDATE",
      scope: "REFLECT",
      originClientId,
      status: "COMPLETED",
      entityId: savedReport.id,
    });

    return {
      id: savedReport.id,
      year: savedReport.year,
      month: savedReport.month,
      data: savedReport.data as ReflectReportData,
      createdAt: savedReport.createdAt,
      updatedAt: savedReport.updatedAt,
      cached: false,
    };
  } catch (error) {
    await publishSyncEvent(userId, {
      type: "INVALIDATE",
      scope: "REFLECT",
      originClientId,
      status: "IDLE",
    });

    // Automatically refund rate limit quota if generation failed
    await Promise.all([
      refundRateLimit("reflect:generate:daily", userId),
      refundRateLimit("reflect:generate:cooldown", userId),
    ]);

    if (
      error instanceof UnprocessableEntityError ||
      error instanceof BadRequestError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    logger.error("Error executing Gemini API call for Reflect report", {
      error: error instanceof Error ? error.message : String(error),
      userId,
      year,
      month,
    });
    throw new BadRequestError({
      code: "AI_SERVICE_ERROR",
      message: "The AI service is momentarily unavailable. Please try again shortly.",
    });
  } finally {
    await redis.del(lockKey);
  }
};

export const chatReflectService = async (
  userId: string,
  input: ChatReflectInput,
  originClientId?: string,
) => {
  const { reportId, message, history = [] } = input;

  // 1. Fetch and verify ownership of the report along with user settings
  const [report, userSettings] = await Promise.all([
    prisma.reflectReport.findFirst({
      where: {
        id: reportId,
        userId,
        isDeleted: false,
      },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
    }),
  ]);

  if (!report) {
    throw new NotFoundError({
      code: "REPORT_NOT_FOUND",
      message: "Reflect report not found.",
    });
  }

  // Atomic mutex lock to prevent concurrent chat responses on the same report
  const lockKey = `lock:reflect:chat:${reportId}`;
  const acquired = await redis.set(lockKey, originClientId || "1", "EX", 45, "NX");
  if (!acquired) {
    throw new ConflictError({
      code: "REPORT_CHAT_IN_PROGRESS",
      message: "Another AI response is currently being generated. Please wait.",
    });
  }

  // Broadcast CHATTING state so other open tabs/devices disable input
  await publishSyncEvent(userId, {
    type: "INVALIDATE",
    scope: "REFLECT",
    status: "CHATTING",
    originClientId,
  });

  const currencySymbol = userSettings?.currencySymbol || "$";
  const reportData = report.data as ReflectReportData;

  const monthName = new Date(Date.UTC(report.year, report.month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const chatSystemInstruction = `You are FinFlow Reflect Chat, a warm, non-judgmental, encouraging AI financial companion.
The user is asking questions grounded in their monthly financial reflection report for ${monthName}.

User Currency Symbol: "${currencySymbol}"

Report Summary Context:
- Month: ${monthName}
- Active Currency Symbol: ${currencySymbol}
- Personality: ${reportData.personality_reveal?.archetype_title} ("${reportData.personality_reveal?.tagline}")
- Summary: Starting Allowance: ${currencySymbol}${reportData.at_a_glance?.starting_allowance}, Total Spent: ${currencySymbol}${reportData.at_a_glance?.total_spent}, Extra Income: ${currencySymbol}${reportData.at_a_glance?.extra_income}, Remaining: ${currencySymbol}${reportData.at_a_glance?.remaining_balance}.
- Spending Breakdown: ${JSON.stringify(reportData.where_money_went?.breakdown || [])}
- Spending Habits: ${JSON.stringify(reportData.spending_habits || [])}
- Key Purchases: ${JSON.stringify(reportData.purchases_to_note || [])}
- Ideas: ${JSON.stringify(reportData.ideas_for_next_month || [])}

Rules:
1. Currency Symbol: The user's active currency symbol is "${currencySymbol}". Whenever stating, citing, or calculating money/costs/amounts, ALWAYS format with "${currencySymbol}" (e.g., "${currencySymbol}500", "${currencySymbol}1,250"). NEVER assume or default to "$" unless the user's currency is "$".
2. Always refer to the month as "${monthName}". Never format the year with a currency symbol (e.g. write "${monthName}", never "10/${currencySymbol}2026").
3. Strictly text only: DO NOT include any emojis anywhere in your response.
4. Always be supportive, concise, helpful, and friendly. Never judge or criticize spending habits.
5. Ground all answers in their specific numbers and categories.
6. Keep responses conversational, clear, and easy to read.`;

  try {
    // Format conversation history for Gemini
    const contents = [
      ...history.map((h) => ({
        role: h.role,
        parts: [{ text: h.content }],
      })),
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    const response = await generateContentWithFallback({
      contents,
      systemInstruction: chatSystemInstruction,
    });

    const reply = response.text || "I'm here to help you reflect on your finances! How else can I assist you?";

    // Persist conversation history to database
    const existingHistory = Array.isArray(reportData.chatHistory) ? reportData.chatHistory : [];
    const updatedChatHistory = [
      ...existingHistory,
      { role: "user" as const, content: message },
      { role: "model" as const, content: reply },
    ];

    await prisma.reflectReport.update({
      where: { id: report.id },
      data: {
        data: {
          ...reportData,
          chatHistory: updatedChatHistory,
        },
      },
    });

    // Notify other sessions that new chat messages are available and chatting is completed
    await publishSyncEvent(userId, {
      type: "INVALIDATE",
      scope: "REFLECT",
      status: "COMPLETED",
      originClientId,
    });

    return {
      reportId: report.id,
      reply,
      chatHistory: updatedChatHistory,
    };
  } catch (error) {
    await publishSyncEvent(userId, {
      type: "INVALIDATE",
      scope: "REFLECT",
      status: "IDLE",
      originClientId,
    });

    if (error instanceof ConflictError) {
      throw error;
    }

    logger.error("Error generating chat response in Reflect Chat", {
      error: error instanceof Error ? error.message : String(error),
      userId,
      reportId,
    });
    throw new BadRequestError({
      code: "AI_CHAT_ERROR",
      message: "Unable to process message right now. Please try again.",
    });
  } finally {
    await redis.del(lockKey);
  }
};
