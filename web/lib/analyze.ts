// Reads ANY uploaded bill, invoice or receipt with a vision LLM and decides
// whether a phone call could save money and what to ask for.
// Gemini (GEMINI_API_KEY, free tier) first, then Anthropic (ANTHROPIC_API_KEY).
// Returns null if no provider is configured or every provider fails: the UI
// then asks the user to fill the details in by hand. It never invents a bill.

import type { Scan } from "@/lib/mock";

type Analysis = {
  is_bill: boolean;
  vendor: string;
  category: string;
  recurring: boolean;
  total: number;
  currency: string;
  plan_or_service: string;
  customer_name: string;
  account_number: string;
  summary: string;
  negotiable: boolean;
  best_ask: string;
  opportunities: string[];
  estimated_savings_low: number;
  estimated_savings_high: number;
};

const PROMPT = `You are Holdless's bill analyst for Canadian consumers. Look at the attached document (a bill, invoice or receipt: telecom, utility, insurance, gym, subscription, auto repair, medical, travel, anything).

1. Extract facts exactly as printed. Never invent numbers, names or account numbers; use "" or 0 when something isn't visible.
2. As a sharp, realistic consumer advocate, judge whether ONE phone call to this business could save money, and what exactly to ask for (e.g. retention discount, waive a fee, labour-rate or price match, goodwill credit, warranty coverage, loyalty discount, cancel an add-on, refund). Be realistic: if it looks fair or there's nothing to ask for, set negotiable=false.
3. Estimate a realistic savings range in dollars. If recurring, per month; if one-time, a one-time amount. Be conservative.

Reply with ONLY this JSON (no markdown):
{"is_bill":bool,"vendor":string,"category":string (short, e.g. "Internet","Mobile","Auto repair","Gym","Hydro","Insurance","Streaming","Other"),"recurring":bool,"total":number,"currency":string,"plan_or_service":string,"customer_name":string,"account_number":string,"summary":string (1-2 plain sentences on what this is and why a call could or couldn't help),"negotiable":bool,"best_ask":string (one sentence: exactly what to ask for on the call),"opportunities":[string, up to 3 short specific asks],"estimated_savings_low":number,"estimated_savings_high":number}`;

async function toBase64(file: File) {
  return Buffer.from(await file.arrayBuffer()).toString("base64");
}

function parseJson(text: string): Analysis {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1)) as Analysis;
}

async function withGemini(file: File, key: string): Promise<Analysis> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: file.type || "image/jpeg", data: await toBase64(file) } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return parseJson(text);
}

async function withAnthropic(file: File, key: string): Promise<Analysis> {
  const isPdf = file.type === "application/pdf";
  const media = {
    type: isPdf ? "document" : "image",
    source: { type: "base64", media_type: file.type || "image/jpeg", data: await toBase64(file) },
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: [media, { type: "text", text: PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return parseJson(data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "");
}

export async function analyzeUpload(file: File): Promise<Scan | null> {
  const providers: [string, (f: File, k: string) => Promise<Analysis>][] = [
    [process.env.GEMINI_API_KEY ?? "", withGemini],
    [process.env.ANTHROPIC_API_KEY ?? "", withAnthropic],
  ];
  for (const [key, run] of providers) {
    if (!key) continue;
    try {
      return toScan(await run(file, key));
    } catch (err) {
      console.error("[analyze] provider failed:", err);
    }
  }
  return null;
}

function toScan(a: Analysis): Scan {
  const low = Math.max(0, Math.round(a.estimated_savings_low || 0));
  const high = Math.max(low, Math.round(a.estimated_savings_high || 0));
  const kind = a.recurring ? "monthly" : "one_time";
  const worth = a.is_bill !== false && a.negotiable && high > 0;
  return {
    company: a.vendor?.trim() || "",
    service: a.category?.trim() || "Other",
    category: a.category?.trim() || "Other",
    province: "BC",
    startPrice: Math.round((a.total || 0) * 100) / 100,
    planName: a.plan_or_service?.trim() || undefined,
    headline: !a.is_bill ? "This doesn't look like a bill" : worth ? (kind === "monthly" ? "You could save" : "Worth a call") : "Looks fair",
    overpayMo: high,
    savingsLow: low,
    savingsHigh: high,
    kind,
    detail: a.summary || "",
    goal: a.best_ask || "",
    opportunities: (a.opportunities ?? []).slice(0, 3),
    bestTime: "",
    worthCalling: worth,
    source: "ai",
  };
}
