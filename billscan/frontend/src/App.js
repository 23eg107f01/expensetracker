import React, { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const CATEGORY_COLORS = {
  "Food & Dining": "#FF6B6B",
  Groceries: "#4ECDC4",
  Transportation: "#45B7D1",
  Healthcare: "#96CEB4",
  Shopping: "#FFEAA7",
  Entertainment: "#DDA0DD",
  Utilities: "#98D8C8",
  Travel: "#F7DC6F",
  Education: "#85C1E9",
  "Personal Care": "#F1948A",
  "Office Supplies": "#A9CCE3",
  Other: "#D5DBDB"
};

const CATEGORY_ICONS = {
  "Food & Dining": "🍽️",
  Groceries: "🛒",
  Transportation: "🚕",
  Healthcare: "⚕️",
  Shopping: "🛍️",
  Entertainment: "🎬",
  Utilities: "💡",
  Travel: "✈️",
  Education: "🎓",
  "Personal Care": "🧴",
  "Office Supplies": "📎",
  Other: "🧾"
};

const EXPENSE_CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transportation",
  "Healthcare",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Travel",
  "Education",
  "Personal Care",
  "Office Supplies",
  "Other"
];

const BILL_RULES = [
  { category: "Food & Dining", subCategory: "Restaurant", terms: ["restaurant", "cafe", "coffee", "dining", "pizza", "burger", "lunch", "dinner", "breakfast", "biryani", "noodles", "naan", "thali", "meal", "food", "mcdonald", "subway", "starbucks"] },
  { category: "Groceries", subCategory: "Supermarket", terms: ["grocery", "supermarket", "groceries", "market", "mart", "fresh", "bigbasket", "walmart", "target", "costco"] },
  { category: "Transportation", subCategory: "Transit", terms: ["uber", "ola", "taxi", "cab", "metro", "bus", "train", "fuel", "petrol", "gas", "parking", "toll"] },
  { category: "Healthcare", subCategory: "Medical", terms: ["pharmacy", "medicine", "medical", "clinic", "hospital", "doctor", "health", "dentist"] },
  { category: "Shopping", subCategory: "Retail", terms: ["shop", "shopping", "store", "retail", "amazon", "clothing", "shoes", "electronics", "mall", "fashion"] },
  { category: "Entertainment", subCategory: "Leisure", terms: ["movie", "cinema", "concert", "ticket", "theatre", "theater", "netflix", "spotify", "event"] },
  { category: "Utilities", subCategory: "Bills", terms: ["electricity", "water", "internet", "wifi", "broadband", "gas bill", "utility", "telecom", "phone bill"] },
  { category: "Travel", subCategory: "Travel", terms: ["flight", "airline", "booking", "travel", "resort", "airport", "hostel", "tour"] },
  { category: "Education", subCategory: "Learning", terms: ["school", "college", "university", "course", "tuition", "fee", "education", "book", "stationery"] },
  { category: "Personal Care", subCategory: "Wellness", terms: ["salon", "spa", "barber", "haircut", "gym", "cosmetic", "skincare", "beauty"] },
  { category: "Office Supplies", subCategory: "Office", terms: ["office", "stationery", "printer", "paper", "ink", "pens", "supplies", "workspace"] }
];

function formatCurrency(amount, currency = "INR") {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return "—";
  }

  const normalizedCurrency = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "INR";

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: normalizedCurrency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${normalizedCurrency} ${Number(amount).toFixed(2)}`;
  }
}

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    try {
      return { __text: await response.text() };
    } catch {
      return { __text: "" };
    }
  }
}

function createEmptyExpenseForm() {
  return {
    merchant: "",
    date: new Date().toISOString().slice(0, 10),
    total_amount: "",
    currency: "INR",
    category: "Other",
    sub_category: "",
    payment_method: "Unknown",
    tax_amount: "",
    discount_amount: "",
    description: "",
    confidence: "low",
    notes: "",
    ocr_text: "",
    receipt_file_name: ""
  };
}

async function prepareImageForOcr(file, maxWidth = 1600) {
  if (!file || typeof createImageBitmap !== "function") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width <= maxWidth) {
      return file;
    }

    const scale = maxWidth / bitmap.width;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.75);
    });

    return blob || file;
  } finally {
    bitmap.close();
  }
}

function normalizeErrorMessage(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "Something went wrong. Please try again.";
  if (text.length > 220 || text.includes("{\"error\"") || text.includes("generativelanguage.googleapis.com")) return "Request failed. Please try again.";
  return text;
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

function normalizeNumericString(input) {
  if (input === null || input === undefined) return null;
  let s = String(input);
  // Replace common currency symbols and non-digit group separators, but keep dots and minus
  s = s.replace(/[₹$€£]/g, "");
  // Remove commas which are used as thousand separators
  s = s.replace(/,/g, "");
  // Remove any spaces
  s = s.replace(/\s+/g, "");
  // Remove any characters except digits, dot and minus
  s = s.replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  // If there are multiple dots, assume last dot is decimal separator and join earlier parts
  const parts = s.split('.');
  if (parts.length > 2) {
    const last = parts.pop();
    s = parts.join('') + '.' + last;
  }
  // Remove stray minus signs not at start
  s = s.replace(/(?!^)-/g, '');
  // Guard against lone dot or lone minus
  if (s === '.' || s === '-' || s === '') return null;
  return s;
}

function extractLines(text) {
  return typeof text === "string" ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function parseIndianAmount(text) {
  if (typeof text !== "string") return null;
  const normalized = normalizeNumericString(text);
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountFromLabeledLine(line) {
  if (typeof line !== "string") return null;
  // Try to capture any chunk that looks like an amount (with or without currency markers)
  const rawMatches = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*[-+]?\d{1,3}(?:[.,]\d{2,3})*(?:[.,]\d{1,2})?|[-+]?\d+(?:[.,]\d{1,2})?/gi)];
  const lastRaw = rawMatches.at(-1)?.[0] || "";
  return parseIndianAmount(lastRaw);
}

function detectCurrency(text) {
  const normalized = normalizeText(text);
  if (/[₹]|\binr\b|\brs\.?\b/.test(normalized)) return "INR";
  if (/[€]|\beur\b/.test(normalized)) return "EUR";
  if (/[£]|\bgbp\b/.test(normalized)) return "GBP";
  return "INR";
}

function extractDate(text) {
  const patterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/gi
  ];

  for (const pattern of patterns) {
    const match = typeof text === "string" ? text.match(pattern) : null;
    if (match && match[0]) return match[0];
  }

  return new Date().toISOString().slice(0, 10);
}

function extractMerchant(lines) {
  const blocked = /total|invoice|receipt|bill|tax|gst|vat|date|time|cash|card|upi|change|subtotal|thank you|items|qty|quantity|amount|balance|payment|order|sale|item/i;
  const candidates = lines.filter((line) => line.length >= 3 && line.length <= 50 && /[a-zA-Z]/.test(line) && !blocked.test(line) && !/^\d/.test(line));
  return candidates[0] || "Unknown Merchant";
}

function extractMerchantFromOcrResult(result, fallbackText) {
  try {
    if (!result || !result.data || !result.data.words) return null;
    // Use the largest word/block by height as likely merchant title/logo
    const words = result.data.words.filter(Boolean);
    if (!words.length) return null;

    // Rank by bounding box height then by confidence
    words.sort((a, b) => {
      const ah = (a.bbox?.y1 - a.bbox?.y0) || (a.bbox?.h) || 0;
      const bh = (b.bbox?.y1 - b.bbox?.y0) || (b.bbox?.h) || 0;
      if (bh !== ah) return bh - ah;
      const ac = a.confidence || 0;
      const bc = b.confidence || 0;
      return bc - ac;
    });

    // Build candidate by joining top few large words that are contiguous in Y coordinate
    const top = words.slice(0, 6);
    const text = top.map((w) => w.text).join(" ").trim();
    if (text && text.length > 2 && /[A-Za-z]/.test(text)) return text;
  } catch (e) {
    // ignore
  }
  // fallback: try the first non-empty line from the OCR text
  const lines = extractLines(fallbackText);
  return lines.find((l) => l.length >= 3 && /[A-Za-z]/.test(l)) || null;
}

function extractTotalAmount(text) {
  const lines = extractLines(text);
  let subtotal = null;
  let taxTotal = 0;
  let labeledTotal = null;
  let fallbackTotal = null;

  lines.forEach((line) => {
    const lower = line.toLowerCase();
    const hasCurrencyMarker = /[₹$€£]|\brs\.?\b|\binr\b/.test(lower);
    const hasAmountLabel = /\b(total|grand total|amount due|net total|balance due|amount payable|total due|payable|subtotal|sub total|cgst|sgst|igst|gst|vat|tax)\b/.test(lower);
    if (!hasCurrencyMarker && !hasAmountLabel) return;

    const amount = amountFromLabeledLine(line);
    if (!Number.isFinite(amount)) return;

    if (/\bsubtotal\b|\bsub total\b/i.test(lower)) {
      subtotal = amount;
      fallbackTotal = amount;
      return;
    }

    if (/\b(cgst|sgst|igst|gst|vat|tax)\b/i.test(lower)) {
      taxTotal += amount;
      return;
    }

    if (/\b(total|grand total|amount due|net total|balance due|amount payable|total due|payable)\b/i.test(lower)) {
      labeledTotal = amount;
      return;
    }

    fallbackTotal = fallbackTotal === null || amount > fallbackTotal ? amount : fallbackTotal;
  });

  if (Number.isFinite(subtotal) && taxTotal > 0) {
    const computedTotal = Number((subtotal + taxTotal).toFixed(2));
    // If a labeled total is missing or wildly different (likely OCR error), prefer computed subtotal+tax
    if (!Number.isFinite(labeledTotal)) return computedTotal;
    // If labeled total is more than twice the computed total, it's very likely an OCR punctuation/digit error
    if (labeledTotal > 0 && computedTotal > 0 && labeledTotal / computedTotal > 2) {
      return computedTotal;
    }
    // If difference is small, trust labeled; otherwise prefer computed when inconsistent
    if (Math.abs(labeledTotal - computedTotal) <= Math.max(0.5, computedTotal * 0.05)) {
      return computedTotal;
    }
  }

  if (Number.isFinite(labeledTotal)) return labeledTotal;
  return fallbackTotal;
}

function classifyBill(text) {
  const normalized = normalizeText(text);
  let best = { category: "Other", subCategory: "General", score: 0 };

  BILL_RULES.forEach((rule) => {
    let score = 0;
    rule.terms.forEach((term) => {
      if (normalized.includes(term)) score += term.length > 4 ? 2 : 1;
    });
    if (score > best.score) best = { category: rule.category, subCategory: rule.subCategory, score };
  });

  return best;
}

function detectPaymentMethod(text) {
  const normalized = normalizeText(text);
  if (/\bupi\b|gpay|google pay|phonepe|paytm/.test(normalized)) return "UPI";
  if (/\bcash\b/.test(normalized)) return "Cash";
  if (/\bdebit\b/.test(normalized)) return "Debit Card";
  if (/\bcredit\b|visa|mastercard|amex|american express/.test(normalized)) return "Credit Card";
  if (/\bcard\b/.test(normalized)) return "Card";
  if (/net banking|internet banking|bank transfer/.test(normalized)) return "Net Banking";
  return "Unknown";
}

function buildDescription({ merchant, category, totalAmount, currency, text }) {
  const amountText = Number.isFinite(Number(totalAmount)) ? formatCurrency(totalAmount, currency) : "an unknown amount";
  const merchantText = merchant && merchant !== "Unknown Merchant" ? merchant : "this merchant";
  const snippet = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return `Scanned ${category.toLowerCase()} bill from ${merchantText} for ${amountText}. ${snippet ? `OCR text starts with: ${snippet}.` : ""}`.trim();
}

function buildNotes({ merchant, category, totalAmount, currency }) {
  const notes = [];
  if (merchant && merchant !== "Unknown Merchant") notes.push(`Merchant detected: ${merchant}.`);
  if (category && category !== "Other") notes.push(`Classified as ${category}.`);
  if (Number.isFinite(Number(totalAmount))) notes.push(`Likely total: ${formatCurrency(totalAmount, currency)}.`);
  notes.push("Review the OCR text if the image was blurry or cropped.");
  return notes.join(" ");
}

function analyzeBillText(text) {
  const lines = extractLines(text);
  const merchant = extractMerchant(lines);
  const classification = classifyBill(text);
  const extractedTotal = extractTotalAmount(text);
  const totalAmount = Number.isFinite(Number(extractedTotal)) ? Number(extractedTotal) : 0;
  const currency = detectCurrency(text);
  const date = extractDate(text);
  const payment_method = detectPaymentMethod(text);
  const confidenceScore = [merchant !== "Unknown Merchant", classification.category !== "Other", Number.isFinite(Number(totalAmount)), text.trim().length > 40].filter(Boolean).length;
  const confidence = confidenceScore >= 4 ? "high" : confidenceScore >= 2 ? "medium" : "low";

  return {
    merchant,
    date,
    total_amount: totalAmount,
    currency,
    category: classification.category,
    sub_category: classification.subCategory,
    payment_method,
    confidence,
    description: buildDescription({ merchant, category: classification.category, totalAmount, currency, text }),
    notes: buildNotes({ merchant, category: classification.category, totalAmount, currency }) + (totalAmount <= 0 ? " Total amount was not clearly detected, so this entry was saved with a zero total for follow-up." : ""),
    ocr_text: text
  };
}

function buildLocalInsight(summary, currency) {
  if (!summary || !summary.count) return "";

  const topCategory = summary.top_category || "Other";
  const topCategoryAmount = Number(summary.top_category_amount || 0);
  const highestExpense = summary.highest_expense;
  const share = summary.total > 0 ? Math.round((topCategoryAmount / summary.total) * 100) : 0;
  const highestText = highestExpense
    ? `The highest single expense is ${highestExpense.merchant || "Unknown Merchant"} at ${formatCurrency(highestExpense.total_amount, highestExpense.currency || currency)}, so that purchase is your biggest individual cost.`
    : "There is not enough expense data yet to identify the highest single expense.";

  return `Your highest spending category is ${topCategory} at ${formatCurrency(topCategoryAmount, currency)}, which is ${share}% of all tracked expenses. ${highestText} Watching ${topCategory} first will give you the clearest view of your spending pattern.`;
}

function getPrimaryCurrency(expenses, summary) {
  return summary?.highest_expense?.currency || expenses.find((expense) => expense.currency)?.currency || "INR";
}

function App() {
  const [form, setForm] = useState(createEmptyExpenseForm());
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  const [ocrMode, setOcrMode] = useState("fast");
  const ocrWorkerRef = useRef(null);
  const ocrWorkerBootRef = useRef(null);
  const ocrWorkerConfiguredRef = useRef(false);
  const primaryCurrency = getPrimaryCurrency(expenses, summary);

  useEffect(() => {
    fetchExpenses();
    fetchSummary();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate();
        ocrWorkerRef.current = null;
      }
      ocrWorkerBootRef.current = null;
      ocrWorkerConfiguredRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Warm OCR engine in the background so first scan is faster.
    getOcrWorker().catch(() => {});
  }, []);

  async function getOcrWorker() {
    if (ocrWorkerRef.current) {
      return ocrWorkerRef.current;
    }

    if (!ocrWorkerBootRef.current) {
      ocrWorkerBootRef.current = Tesseract.createWorker("eng");
    }

    ocrWorkerRef.current = await ocrWorkerBootRef.current;

    if (!ocrWorkerConfiguredRef.current && ocrWorkerRef.current?.setParameters) {
      try {
        await ocrWorkerRef.current.setParameters({
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: "0"
        });
      } catch {
        // Keep scanning even if optional tuning fails.
      }
      ocrWorkerConfiguredRef.current = true;
    }

    return ocrWorkerRef.current;
  }

  async function fetchExpenses() {
    try {
      const response = await fetch("/api/expenses");
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error || data?.__text || "Failed to load expenses");
      setExpenses(data.expenses || []);
    } catch (fetchError) {
      setError(normalizeErrorMessage(fetchError.message));
    }
  }

  async function fetchSummary() {
    try {
      const response = await fetch("/api/summary");
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error || data?.__text || "Failed to load summary");
      setSummary(data);
      return data;
    } catch (fetchError) {
      setError(normalizeErrorMessage(fetchError.message));
      return null;
    }
  }

  async function fetchAnalysis(summaryData) {
    setAnalysisLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analyze-spending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summaryData })
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error || data?.__text || "Failed to generate analysis");

      setAnalysis(data?.analysis || buildLocalInsight(summaryData, primaryCurrency));
    } finally {
      setAnalysisLoading(false);
    }
  }

  function handleFormChange(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function handleSelectFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      setError("Please choose an image file to scan.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setForm(createEmptyExpenseForm());
    setError("");
    setSuccess("");
    setScanProgress("");
  }

  async function handleScanImage() {
    if (!selectedFile) {
      setError("Choose a bill image before scanning.");
      return;
    }

    setIsScanning(true);
    setError("");
    setSuccess("");
    setScanProgress("Preparing image...");

    try {
      const maxWidth = ocrMode === "fast" ? 950 : 1600;
      const optimizedImage = await prepareImageForOcr(selectedFile, maxWidth);
      setScanProgress("Starting OCR worker...");
      const worker = await getOcrWorker();
      setScanProgress("Recognizing text...");
        const result = await worker.recognize(optimizedImage);

        const text = result?.data?.text?.trim() || "";
      if (!text) {
        throw new Error("No readable text was found in the image.");
      }

      const baseAnalysis = analyzeBillText(text);
      // Prefer visually prominent text (large title/logo) as merchant when available from OCR bounding boxes
      const visualMerchant = extractMerchantFromOcrResult(result, text);
      let geminiAnalysis = null;
      try {
        setScanProgress("Enhancing receipt data with Google AI...");
        const response = await fetch("/api/analyze-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, fallback: baseAnalysis, summary })
        });
        const data = await parseResponse(response);
        if (response.ok) {
          geminiAnalysis = data?.analysis || null;
        }
      } catch {
        geminiAnalysis = null;
      }

      const scannedExpense = {
        ...baseAnalysis,
        ...(geminiAnalysis || {}),
        merchant: visualMerchant || baseAnalysis.merchant,
        receipt_file_name: selectedFile.name,
        ocr_text: text,
        source: "ocr",
        ai_provider: geminiAnalysis ? "google-gemini" : "local"
      };

      if (geminiAnalysis?.merchant && !visualMerchant) {
        scannedExpense.merchant = geminiAnalysis.merchant;
      }

      if (geminiAnalysis?.description) {
        scannedExpense.description = geminiAnalysis.description;
      }

      if (geminiAnalysis?.notes) {
        scannedExpense.notes = geminiAnalysis.notes;
      }

      if (geminiAnalysis?.total_amount !== undefined && geminiAnalysis?.total_amount !== null) {
        const parsedTotal = Number(geminiAnalysis.total_amount);
        if (Number.isFinite(parsedTotal)) {
          scannedExpense.total_amount = parsedTotal;
        }
      }

      setForm(scannedExpense);
      setSuccess(`Extracted ${scannedExpense.merchant || "expense"} for ${formatCurrency(scannedExpense.total_amount, scannedExpense.currency)}.`);
      setAnalysis("");
    } catch (scanError) {
      setError(normalizeErrorMessage(scanError.message || "OCR failed"));
    } finally {
      setIsScanning(false);
      setScanProgress("");
    }
  }

  async function handleSaveScannedBill() {
    const totalAmount = Number(form.total_amount);

    if (!form.merchant?.trim()) {
      setError("Merchant is required before saving.");
      return;
    }

    if (!Number.isFinite(totalAmount)) {
      setError("Total amount must be a valid number before saving.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        total_amount: totalAmount,
        receipt_file_name: selectedFile?.name || form.receipt_file_name || "",
        source: form.source || (selectedFile ? "ocr" : "manual")
      };

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || data?.__text || "Failed to save bill");
      }

      await fetchExpenses();
      const nextSummary = await fetchSummary();
      if (nextSummary) {
        fetchAnalysis(nextSummary);
      }
      setActiveTab("expenses");
      setSuccess(`Saved ${payload.merchant} for ${formatCurrency(payload.total_amount, payload.currency)}.`);
    } catch (saveError) {
      setError(normalizeErrorMessage(saveError.message || "Failed to save bill"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      const response = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error || data?.__text || "Failed to delete expense");

      await fetchExpenses();
      const nextSummary = await fetchSummary();
      if (activeTab === "insights" && nextSummary && expenses.length > 1) {
        fetchAnalysis(nextSummary);
      }
    } catch (fetchError) {
      setError(normalizeErrorMessage(fetchError.message));
    }
  }

  function handleTabChange(tab) {
    setActiveTab(tab);
    setError("");
    if (tab === "insights" && expenses.length > 0 && summary) {
      setAnalysis(buildLocalInsight(summary, primaryCurrency));
      fetchAnalysis(summary);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">⚡</div>
          <div>
            <h1>BillScan</h1>
            <p>Image-to-text bills with local classification</p>
          </div>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Main navigation">
        <button className={activeTab === "upload" ? "tab active" : "tab"} type="button" onClick={() => handleTabChange("upload")}>📷 Scan Bill</button>
        <button className={activeTab === "expenses" ? "tab active" : "tab"} type="button" onClick={() => handleTabChange("expenses")}>
          📋 Expenses{expenses.length > 0 && <span className="count-badge">{expenses.length}</span>}
        </button>
        <button className={activeTab === "insights" ? "tab active" : "tab"} type="button" onClick={() => handleTabChange("insights")}>📊 Insights</button>
      </nav>

      <main className="app-main">
        {activeTab === "upload" && (
          <section className="upload-card">
            <div className="section-heading centered">
              <h2>Scan a Bill</h2>
              <p>Upload a receipt image, extract the text locally, and let BillScan classify the bill automatically.</p>
            </div>

            <ExpenseForm
              form={form}
              selectedFile={selectedFile}
              previewUrl={previewUrl}
              onSelectFile={handleSelectFile}
              onScanImage={handleScanImage}
              onSaveBill={handleSaveScannedBill}
              onFormChange={handleFormChange}
              isScanning={isScanning}
              isSaving={isSaving}
              scanProgress={scanProgress}
              ocrMode={ocrMode}
              onOcrModeChange={setOcrMode}
            />

            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
          </section>
        )}

        {activeTab === "expenses" && (
          <section className="expenses-view">
            <SummaryBar summary={summary} expenses={expenses} />
            {error && <div className="alert alert-error">{error}</div>}
            {expenses.length === 0 ? (
              <EmptyState icon="🧾" title="No bills yet" text="Scan your first receipt to see totals, categories, text extraction, and insights here." actionText="Scan a Bill" onAction={() => handleTabChange("upload")} />
            ) : (
              <div className="expense-list">
                {expenses.map((expense) => (
                  <ExpenseCard key={expense.id} expense={expense} onDelete={handleDelete} onEdit={() => { fetchExpenses(); fetchSummary(); }} />
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "insights" && (
          <section className="insights-view">
            {error && <div className="alert alert-error">{error}</div>}
            {expenses.length === 0 ? (
              <EmptyState icon="📊" title="Insights need a few bills" text="Scan a few receipts to unlock charts and a local spending readout." actionText="Scan a Bill" onAction={() => handleTabChange("upload")} />
            ) : (
              <>
                <div className="section-heading centered"><h2>Spending Breakdown</h2></div>
                <InsightHighlights summary={summary} currency={primaryCurrency} />
                <SpendingChart summary={summary} currency={primaryCurrency} />
                <div className="section-heading"><h2>💡 Spending Analysis</h2></div>
                {analysisLoading && <div className="shimmer" />}
                {analysis && !analysisLoading && (
                  <div className="analysis-card">
                    <span className="analysis-icon">🤖</span>
                    <p>{analysis}</p>
                  </div>
                )}
                <button className="btn btn-secondary refresh-btn" type="button" onClick={() => summary && fetchAnalysis(summary)} disabled={analysisLoading}>Refresh Analysis</button>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function ExpenseForm({ form, selectedFile, previewUrl, onSelectFile, onScanImage, onSaveBill, onFormChange, isScanning, isSaving, scanProgress, ocrMode, onOcrModeChange }) {
  return (
    <div className="expense-form">
      <div className="scan-panel">
        <label className="field wide">
          <span>Bill image</span>
          <input className="image-input" type="file" accept="image/*" onChange={(event) => onSelectFile(event.target.files?.[0])} />
        </label>

        <div className={previewUrl ? "preview-frame" : "preview-frame empty-preview"}>
          {previewUrl ? <img src={previewUrl} alt="Selected bill preview" /> : <>
            <strong>No image selected</strong>
            <span>Choose a receipt or bill image to extract text and classify it.</span>
          </>}
          {previewUrl && (
            <div className="preview-meta">
              <strong>{selectedFile?.name || "Selected image"}</strong>
              <span>{selectedFile ? `${Math.round(selectedFile.size / 1024)} KB` : ""}</span>
            </div>
          )}
        </div>

        <div className="scan-actions">
          <label className="field" style={{ minWidth: "11rem" }}>
            <span>OCR Mode</span>
            <select value={ocrMode} onChange={(event) => onOcrModeChange(event.target.value)} disabled={isScanning}>
              <option value="fast">Fast (quicker scan)</option>
              <option value="accurate">Accurate (better detail)</option>
            </select>
          </label>
          <button className="btn btn-secondary" type="button" onClick={onScanImage} disabled={!selectedFile || isScanning}>
            {isScanning ? (<><span className="spinner" />Scanning...</>) : "🔎 Extract Text & Classify"}
          </button>
          {scanProgress && <span className="scan-status">{scanProgress}</span>}
        </div>

        <div className="scan-actions-row">
          <button className="btn btn-primary" type="button" onClick={onSaveBill} disabled={isScanning || isSaving || !selectedFile}>
            {isSaving ? (<><span className="spinner" />Saving...</>) : "💾 Save Scanned Bill"}
          </button>
          <span className="scan-status">Scan first, then review or edit fields before saving.</span>
        </div>
      </div>

      <div className="extracted-summary editable-summary">
        <label className="field">
          <span>Merchant</span>
          <input type="text" value={form?.merchant || ""} onChange={(event) => onFormChange("merchant", event.target.value)} />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={form?.date || ""} onChange={(event) => onFormChange("date", event.target.value)} />
        </label>
        <label className="field">
          <span>Total</span>
          <input type="number" step="0.01" value={form?.total_amount ?? ""} onChange={(event) => onFormChange("total_amount", event.target.value)} />
        </label>
        <label className="field">
          <span>Currency</span>
          <input type="text" maxLength="3" value={form?.currency || "INR"} onChange={(event) => onFormChange("currency", event.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={form?.category || "Other"} onChange={(event) => onFormChange("category", event.target.value)}>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subcategory</span>
          <input type="text" value={form?.sub_category || ""} onChange={(event) => onFormChange("sub_category", event.target.value)} />
        </label>
        <label className="field">
          <span>Payment</span>
          <input type="text" value={form?.payment_method || ""} onChange={(event) => onFormChange("payment_method", event.target.value)} />
        </label>
        <label className="field">
          <span>Tax</span>
          <input type="number" step="0.01" value={form?.tax_amount ?? ""} onChange={(event) => onFormChange("tax_amount", event.target.value)} />
        </label>
        <label className="field">
          <span>Discount</span>
          <input type="number" step="0.01" value={form?.discount_amount ?? ""} onChange={(event) => onFormChange("discount_amount", event.target.value)} />
        </label>
        <label className="field wide">
          <span>Description</span>
          <textarea value={form?.description || ""} onChange={(event) => onFormChange("description", event.target.value)} />
        </label>
        <label className="field wide">
          <span>Notes</span>
          <textarea value={form?.notes || ""} onChange={(event) => onFormChange("notes", event.target.value)} />
        </label>
        <label className="field wide">
          <span>Confidence</span>
          <input type="text" value={form?.confidence || "low"} onChange={(event) => onFormChange("confidence", event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function SummaryBar({ summary, expenses }) {
  const currency = expenses[0]?.currency || "INR";
  const categoryEntries = Object.entries(summary?.by_category || {}).filter(([, amount]) => amount > 0);

  return (
    <div className="summary-bar">
      <div className="summary-stat"><span>Total</span><strong>{formatCurrency(summary?.total || 0, currency)}</strong></div>
      <div className="summary-stat"><span>Bills</span><strong>{summary?.count || 0}</strong></div>
      <div className="category-pills">
        {categoryEntries.map(([category, amount]) => (
          <span className="category-pill" key={category}><span>{CATEGORY_ICONS[category] || CATEGORY_ICONS.Other}</span>{category}<strong>{formatCurrency(amount, currency)}</strong></span>
        ))}
      </div>
    </div>
  );
}

function ExpenseCard({ expense, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(expense);
  const category = expense.category || "Other";
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
  const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.Other;

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    try {
      const response = await fetch(`/api/expenses/${expense.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(data?.error || "Failed to update expense");
      onEdit();
      setIsEditing(false);
    } catch (error) {
      alert(error.message);
    }
  };

  if (isEditing) {
    return (
      <article className="expense-card" style={{ "--category-color": color }}>
        <div className="expense-top">
          <h3>Edit Expense</h3>
        </div>
        <div className="edit-form">
          <div className="form-group">
            <label>Merchant <input type="text" value={editForm.merchant || ""} onChange={(e) => handleEditChange("merchant", e.target.value)} /></label>
          </div>
          <div className="form-group">
            <label>Date <input type="date" value={editForm.date || ""} onChange={(e) => handleEditChange("date", e.target.value)} /></label>
          </div>
          <div className="form-group">
            <label>Total Amount <input type="number" step="0.01" value={editForm.total_amount || ""} onChange={(e) => handleEditChange("total_amount", e.target.value)} /></label>
          </div>
          <div className="form-group">
            <label>Currency <input type="text" value={editForm.currency || "INR"} onChange={(e) => handleEditChange("currency", e.target.value)} /></label>
          </div>
          <div className="form-group">
            <label>Category
              <select value={editForm.category || "Other"} onChange={(e) => handleEditChange("category", e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </label>
          </div>
          <div className="form-group">
            <label>Payment Method <input type="text" value={editForm.payment_method || ""} onChange={(e) => handleEditChange("payment_method", e.target.value)} /></label>
          </div>
          <div className="form-group">
            <label>Notes <textarea value={editForm.notes || ""} onChange={(e) => handleEditChange("notes", e.target.value)} /></label>
          </div>
          <div className="edit-actions">
            <button className="btn btn-primary" onClick={handleSaveEdit}>💾 Save</button>
            <button className="btn btn-secondary" onClick={() => { setIsEditing(false); setEditForm(expense); }}>Cancel</button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="expense-card" style={{ "--category-color": color }}>
      <div className="expense-top">
        <button className="expense-main" type="button" onClick={() => setExpanded((current) => !current)}>
          <span className="expense-icon">{icon}</span>
          <span className="expense-title"><strong>{expense.merchant || "Unknown Merchant"}</strong><small>{expense.date || "Date unknown"}</small></span>
        </button>
        <div className="expense-actions">
          <span className="expense-amount">{formatCurrency(expense.total_amount, expense.currency)}</span>
          <span className="category-badge">{category}</span>
          <button className="icon-btn edit" type="button" aria-label={`Edit ${expense.merchant || "expense"}`} onClick={() => setIsEditing(true)}>✎</button>
          <button className="icon-btn danger" type="button" aria-label={`Delete ${expense.merchant || "expense"}`} onClick={() => onDelete(expense.id)}>×</button>
          <button className={expanded ? "icon-btn chevron open" : "icon-btn chevron"} type="button" aria-label={expanded ? "Collapse expense" : "Expand expense"} onClick={() => setExpanded((current) => !current)}>▾</button>
        </div>
      </div>

      {expanded && (
        <div className="expense-details">
          <div className="detail-grid">
            <Detail label="Merchant" value={expense.merchant} />
            <Detail label="Date" value={expense.date} />
            <Detail label="Total" value={formatCurrency(expense.total_amount, expense.currency)} />
            <Detail label="Currency" value={expense.currency} />
            <Detail label="Category" value={expense.category} />
            <Detail label="Subcategory" value={expense.sub_category} />
            <Detail label="Payment" value={expense.payment_method} />
            <Detail label="Tax" value={formatCurrency(expense.tax_amount, expense.currency)} />
            <Detail label="Discount" value={formatCurrency(expense.discount_amount, expense.currency)} />
            <Detail label="Source" value={expense.source || "manual"} />
            <Detail label="Receipt File" value={expense.receipt_file_name} />
            <Detail label="Created" value={new Date(expense.created_at).toLocaleString()} />
            <Detail label="Confidence" value={<ConfidenceBadge value={expense.confidence} />} />
            <Detail label="Description" value={expense.description} wide />
            <Detail label="OCR Text" value={expense.ocr_text} wide />
          </div>

          {expense.notes && <div className="notes-box">{expense.notes}</div>}
        </div>
      )}
    </article>
  );
}

function Detail({ label, value, wide = false }) {
  return <div className={wide ? "detail wide" : "detail"}><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function ConfidenceBadge({ value }) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "low";
  return <span className={`confidence ${normalized}`}>{value || "low"}</span>;
}

function InsightHighlights({ summary, currency }) {
  const highestExpense = summary?.highest_expense;
  const topCategory = summary?.top_category || "—";
  const topCategoryAmount = summary?.top_category_amount || 0;
  const topMerchant = summary?.top_merchant || "—";
  const topMerchantAmount = summary?.top_merchant_amount || 0;

  return (
    <div className="insight-grid">
      <div className="insight-tile"><span>Highest Category</span><strong>{topCategory}</strong><p>{formatCurrency(topCategoryAmount, currency)} spent here overall</p></div>
      <div className="insight-tile highlight"><span>Highest Expense</span><strong>{highestExpense?.merchant || "—"}</strong><p>{highestExpense ? `${formatCurrency(highestExpense.total_amount, highestExpense.currency || currency)} in ${highestExpense.category}` : "Scan bills to find the biggest cost"}</p></div>
      <div className="insight-tile"><span>Top Merchant</span><strong>{topMerchant}</strong><p>{formatCurrency(topMerchantAmount, currency)} total spend</p></div>
    </div>
  );
}

function SpendingChart({ summary, currency }) {
  const data = Object.entries(summary?.by_category || {}).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value, color: CATEGORY_COLORS[name] || CATEGORY_COLORS.Other }));

  return (
    <div className="chart-panel">
      <ResponsiveContainer width="100%" height={350}>
        <PieChart width={400} height={350}>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="48%" outerRadius={110} label={({ name, percent }) => (percent > 0.05 ? `${name}\n${Math.round(percent * 100)}%` : "")} labelLine={false}>
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={(value) => formatCurrency(value, currency)} />
          <Legend verticalAlign="bottom" height={48} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyState({ icon, title, text, actionText, onAction }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p><button className="btn btn-primary" type="button" onClick={onAction}>{actionText}</button></div>;
}

export default App;
