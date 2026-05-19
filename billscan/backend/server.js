import "dotenv/config";
import express from "express";
import cors from "cors";
import { Client } from "langsmith";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT =  process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "expenses.json");

// Initialize LangSmith client
const langsmithClient = process.env.LANGSMITH_API_KEY && process.env.LANGSMITH_TRACING !== "false" ? new Client({
  apiUrl: process.env.LANGSMITH_ENDPOINT,
  apiKey: process.env.LANGSMITH_API_KEY
}) : null;

// Middleware to enable LangSmith tracing if available
function withLangSmithTracing(operationName) {
  return (req, res, next) => {
    if (!langsmithClient) {
      return next();
    }

    req.langsmithTrace = {
      operationName,
      startedAt: Date.now(),
      inputs: {
        method: req.method,
        path: req.originalUrl
      },
      outputs: {}
    };

    res.once("finish", () => {
      const trace = req.langsmithTrace;
      if (!trace || trace.emitted) {
        return;
      }

      trace.emitted = true;
      const latency_ms = Date.now() - trace.startedAt;

      langsmithClient.createRun({
        name: trace.operationName,
        run_type: "chain",
        inputs: trace.inputs,
        outputs: {
          ...trace.outputs,
          status_code: res.statusCode,
          latency_ms
        }
      }).catch(() => {});
    });

    next();
  };
}

function traceToLangSmith(req, { inputs = {}, outputs = {} } = {}) {
  if (!req.langsmithTrace) {
    return;
  }

  req.langsmithTrace.inputs = {
    ...req.langsmithTrace.inputs,
    ...inputs
  };

  req.langsmithTrace.outputs = {
    ...req.langsmithTrace.outputs,
    ...outputs
  };
}


function createLocalSpendingAnalysis(summary) {
  const byCategory = summary?.by_category || {};
  const topEntry = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const topCategory = topEntry?.[0] || "no category yet";
  const topAmount = Number(topEntry?.[1] || 0);
  const count = summary?.count || 0;
  const total = Number(summary?.total || 0);
  const merchant = summary?.top_merchant || "your top merchant";
  const highestExpense = summary?.highest_expense;
  const currency = highestExpense?.currency || summary?.currency || "INR";
  const topShare = total > 0 ? Math.round((topAmount / total) * 100) : 0;
  const highestExpenseText = highestExpense
    ? `The highest single bill is ${highestExpense.merchant || "Unknown Merchant"} at ${currency} ${Number(highestExpense.total_amount || 0).toFixed(2)}, so that purchase is the biggest individual cost in your uploaded bills.`
    : "There is not enough bill data yet to identify the highest single expense.";

  return `Your highest spending category is ${topCategory} at ${currency} ${topAmount.toFixed(2)}, which is ${topShare}% of your tracked total across ${count} bill${count === 1 ? "" : "s"}. ${highestExpenseText} This means ${topCategory} is where you are spending more overall, while ${merchant} stands out as the merchant with the highest accumulated spend.`;
}

function buildGeminiPrompt(summary) {
  const safeSummary = {
    total: summary?.total || 0,
    count: summary?.count || 0,
    top_category: summary?.top_category || null,
    top_category_amount: summary?.top_category_amount || 0,
    top_merchant: summary?.top_merchant || null,
    top_merchant_amount: summary?.top_merchant_amount || 0,
    highest_expense: summary?.highest_expense || null,
    by_category: summary?.by_category || {}
  };

  return [
    "You are an expense-tracking assistant.",
    "Write a concise, practical spending analysis in 2-4 short sentences.",
    "Focus on the highest category, the largest single expense, and one actionable suggestion.",
    "Do not mention policy, chain-of-thought, or internal reasoning.",
    "Return plain text only.",
    `Summary data: ${JSON.stringify(safeSummary)}`
  ].join("\n");
}

async function createSpendingAnalysis(summary) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { analysis: createLocalSpendingAnalysis(summary), provider: "local" };
  }

  const prompt = buildGeminiPrompt(summary);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 220,
        topP: 0.95,
        topK: 40
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Gemini request failed with status ${response.status}`);
  }

  const data = await response.json();
  const analysis = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("").trim();

  if (!analysis) {
    throw new Error("Gemini returned an empty analysis response");
  }

  return { analysis, provider: "google-gemini" };
}
async function createReceiptAnalysis({ text, fallback = {}, summary = {} }) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { analysis: null, provider: "local" };
  }

  const prompt = [
    "You are a receipt parsing assistant.",
    "Extract structured receipt data from the OCR text.",
    "Return plain JSON only, with these keys: merchant, date, total_amount, currency, category, sub_category, payment_method, confidence, description, notes.",
    "Use null for unknown values.",
    "Keep category values aligned with common expense categories like Food & Dining, Groceries, Transportation, Healthcare, Shopping, Entertainment, Utilities, Travel, Education, Personal Care, Office Supplies, or Other.",
    "Prefer categories and merchants that are consistent with the provided spending summary when the OCR text is ambiguous.",
    `Fallback data: ${JSON.stringify(fallback)}`,
    `Spending summary context: ${JSON.stringify(summary)}`,
    `OCR text: ${text || ""}`
  ].join("\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        topP: 0.95,
        topK: 40
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Gemini request failed with status ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("").trim();
  if (!rawText) {
    throw new Error("Gemini returned an empty receipt analysis response");
  }

  const jsonText = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let analysis;
  try {
    analysis = JSON.parse(jsonText);
  } catch {
    throw new Error("Gemini receipt analysis was not valid JSON");
  }

  return { analysis, provider: "google-gemini" };
}

async function saveExpensesToDisk() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    DATA_FILE,
    JSON.stringify({ expenses, updated_at: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

app.use(cors());
app.use(express.json());

function computeSummary() {
  const by_category = {};
  const merchantTotals = {};
  let total = 0;
  let highest_expense = null;

  expenses.forEach((expense) => {
    const amount =
      typeof expense.total_amount === "number" && Number.isFinite(expense.total_amount)
        ? expense.total_amount
        : null;

    if (amount === null) {
      return;
    }

    total += amount;

    const category = expense.category || "Other";
    by_category[category] = (by_category[category] || 0) + amount;

    const merchant = expense.merchant || "Unknown";
    merchantTotals[merchant] = (merchantTotals[merchant] || 0) + amount;

    if (!highest_expense || amount > highest_expense.total_amount) {
      highest_expense = {
        id: expense.id,
        merchant: expense.merchant || "Unknown Merchant",
        category,
        total_amount: amount,
        currency: expense.currency || "INR",
        date: expense.date || null
      };
    }
  });

  const topCategoryEntry = Object.entries(by_category).sort((a, b) => b[1] - a[1])[0];
  const topMerchantEntry = Object.entries(merchantTotals).sort((a, b) => b[1] - a[1])[0];

  return {
    total,
    by_category,
    count: expenses.length,
    top_merchant: topMerchantEntry?.[0] || null,
    top_merchant_amount: topMerchantEntry?.[1] || 0,
    top_category: topCategoryEntry?.[0] || null,
    top_category_amount: topCategoryEntry?.[1] || 0,
    highest_expense
  };
}

function normalizeExpensePayload(payload) {
  const merchant = typeof payload?.merchant === "string" && payload.merchant.trim() ? payload.merchant.trim() : "Unknown Merchant";
  const category = typeof payload?.category === "string" && payload.category.trim() ? payload.category.trim() : "Other";
  const currency = typeof payload?.currency === "string" && /^[A-Z]{3}$/.test(payload.currency.trim()) ? payload.currency.trim() : "INR";
  const totalAmount = Number(payload?.total_amount ?? payload?.amount);

  if (!Number.isFinite(totalAmount)) {
    return { error: "Total amount is required and must be a number" };
  }

  return {
    expense: {
      id: idCounter++,
      merchant,
      date: typeof payload?.date === "string" && payload.date.trim() ? payload.date.trim() : new Date().toISOString().slice(0, 10),
      total_amount: totalAmount,
      currency,
      category,
      sub_category: typeof payload?.sub_category === "string" ? payload.sub_category.trim() : "",
      items: Array.isArray(payload?.items) ? payload.items : [],
      payment_method: typeof payload?.payment_method === "string" && payload.payment_method.trim() ? payload.payment_method.trim() : "Unknown",
      tax_amount: Number.isFinite(Number(payload?.tax_amount)) ? Number(payload.tax_amount) : null,
      discount_amount: Number.isFinite(Number(payload?.discount_amount)) ? Number(payload.discount_amount) : null,
      description: typeof payload?.description === "string" ? payload.description.trim() : "",
      confidence: typeof payload?.confidence === "string" && payload.confidence.trim() ? payload.confidence.trim() : "low",
      notes: typeof payload?.notes === "string" ? payload.notes.trim() : "",
      ocr_text: typeof payload?.ocr_text === "string" ? payload.ocr_text.trim() : "",
      receipt_file_name: typeof payload?.receipt_file_name === "string" ? payload.receipt_file_name.trim() : "",
      source: typeof payload?.source === "string" && payload.source.trim() ? payload.source.trim() : "manual",
      created_at: new Date().toISOString()
    }
  };
}

app.post("/api/expenses", withLangSmithTracing("create_expense"), async (req, res) => {
  try {
    const result = normalizeExpensePayload(req.body);

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    expenses.push(result.expense);
    await saveExpensesToDisk();
    
    traceToLangSmith(req, {
      inputs: { merchant: result.expense.merchant, amount: result.expense.total_amount, category: result.expense.category },
      outputs: { success: true, expense_id: result.expense.id }
    });
    
    res.status(201).json({ success: true, expense: result.expense });
  } catch (error) {
    res.status(500).json({ error: "Failed to create expense" });
  }
});

app.get("/api/expenses", (req, res) => {
  try {
    const sortedExpenses = [...expenses].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    res.json({ expenses: sortedExpenses });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

app.put("/api/expenses/:id", withLangSmithTracing("update_expense"), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const expenseIndex = expenses.findIndex((e) => e.id === id);

    if (expenseIndex === -1) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    const result = normalizeExpensePayload(req.body);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    const updated = { ...result.expense, id, created_at: expenses[expenseIndex].created_at, updated_at: new Date().toISOString() };
    expenses[expenseIndex] = updated;
    await saveExpensesToDisk();
    traceToLangSmith(req, {
      inputs: { expense_id: id },
      outputs: { success: true, updated_at: updated.updated_at }
    });
    res.json({ success: true, expense: updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update expense" });
  }
});

app.delete("/api/expenses/:id", withLangSmithTracing("delete_expense"), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const originalLength = expenses.length;
    expenses = expenses.filter((expense) => expense.id !== id);

    if (expenses.length === originalLength) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    await saveExpensesToDisk();
    traceToLangSmith(req, {
      inputs: { expense_id: id },
      outputs: { success: true, remaining_count: expenses.length }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

app.get("/api/summary", (req, res) => {
  try {
    res.json(computeSummary());
  } catch (error) {
    res.status(500).json({ error: "Failed to compute summary" });
  }
});

app.post("/api/analyze-spending", withLangSmithTracing("analyze_spending"), async (req, res) => {
  try {
    const summary = req.body?.summary;
    const result = await createSpendingAnalysis(summary);

    traceToLangSmith(req, {
      inputs: { top_category: summary?.top_category, total: summary?.total },
      outputs: { analysis_generated: true, provider: result.provider }
    });

    res.json({ analysis: result.analysis, local: result.provider === "local", provider: result.provider });
  } catch (error) {
    const fallback = createLocalSpendingAnalysis(req.body?.summary);
    traceToLangSmith(req, {
      inputs: { top_category: req.body?.summary?.top_category, total: req.body?.summary?.total },
      outputs: { analysis_generated: true, provider: "local_fallback", error: true }
    });
    res.json({ analysis: fallback, local: true, provider: "local_fallback" });
  }
});

app.post("/api/analyze-receipt", withLangSmithTracing("analyze_receipt"), async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const fallback = req.body?.fallback && typeof req.body.fallback === "object" ? req.body.fallback : {};
    const summary = req.body?.summary && typeof req.body.summary === "object" ? req.body.summary : {};
    const result = await createReceiptAnalysis({ text, fallback, summary });

    traceToLangSmith(req, {
      inputs: { text_length: text.length, has_summary: Object.keys(summary).length > 0 },
      outputs: { provider: result.provider, receipt_generated: true }
    });

    res.json({ analysis: result.analysis, local: result.provider === "local", provider: result.provider });
  } catch (error) {
    traceToLangSmith(req, {
      inputs: { text_length: typeof req.body?.text === "string" ? req.body.text.length : 0 },
      outputs: { provider: "local_fallback", receipt_generated: true, error: true }
    });
    res.status(500).json({ error: "Failed to analyze receipt text" });
  }
});

loadExpensesFromDisk().finally(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BillScan backend running on port ${PORT}`);
  });
});


