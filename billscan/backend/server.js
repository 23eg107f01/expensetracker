import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;

let expenses = [];
let idCounter = 1;

app.use(cors());
app.use(express.json());

function createSpendingAnalysis(summary) {
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

app.post("/api/expenses", (req, res) => {
  try {
    const result = normalizeExpensePayload(req.body);

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    expenses.push(result.expense);
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

app.delete("/api/expenses/:id", (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const originalLength = expenses.length;
    expenses = expenses.filter((expense) => expense.id !== id);

    if (expenses.length === originalLength) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

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

app.post("/api/analyze-spending", async (req, res) => {
  try {
    const summary = req.body?.summary;

    res.json({ analysis: createSpendingAnalysis(summary), local: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to analyze spending summary" });
  }
});

app.listen(PORT, () => {
  console.log(`BillScan backend running on http://localhost:${PORT}`);
});
