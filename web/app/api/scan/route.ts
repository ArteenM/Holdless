import { SAMPLE_SCANS, type Scan } from "@/lib/mock";

// POST /api/scan, multipart: `sample=<id>` or `file=<bill image/PDF>` → Scan
// Forwards to the data service's POST /bills/scan. If it is down, slow or
// errors, answers with the sample values so the home screen always has a card.

const DATA_API = process.env.DATA_API_URL || "http://localhost:8100";
const SCAN_TIMEOUT_MS = 25000; // a real photo goes through Claude vision

type ScanResult = {
  bill: {
    provider: string;
    service: string;
    province?: string | null;
    plan_name?: string | null;
    account_tenure_years?: number | null;
  };
  you_pay: number;
  overpay_mo: number;
  headline: string;
  detail: string;
  best_time?: { label: string } | null;
  worth_calling: boolean;
};

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const sample = form?.get("sample");
  const file = form?.get("file");
  const fallbackId = typeof sample === "string" && sample in SAMPLE_SCANS ? sample : "rogers_internet";

  try {
    const body = new FormData();
    if (typeof sample === "string") body.set("sample", sample);
    else if (file instanceof File) body.set("file", file);
    else throw new Error("send `sample` or `file`");

    const res = await fetch(`${DATA_API}/bills/scan`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`POST /bills/scan → ${res.status}: ${await res.text()}`);
    return Response.json(toScan(await res.json()));
  } catch (e) {
    console.error("[scan] data service failed, using sample values:", e);
    return Response.json({ ...SAMPLE_SCANS[fallbackId], source: "fallback" } satisfies Scan);
  }
}

function toScan(r: ScanResult): Scan {
  const overpayMo = Math.round(r.overpay_mo);
  const service = r.bill.service;
  return {
    company: r.bill.provider,
    service: service.charAt(0).toUpperCase() + service.slice(1),
    province: r.bill.province ?? "",
    startPrice: r.you_pay,
    planName: r.bill.plan_name ?? undefined,
    yearsCustomer: r.bill.account_tenure_years ?? undefined,
    // The API's headline already includes the amount ("You're overpaying $41/mo");
    // the card shows the amount large on its own line.
    headline: overpayMo > 0 ? "You're overpaying" : r.headline,
    overpayMo,
    detail: r.detail,
    bestTime: r.best_time ? `Best time to call: ${r.best_time.label}` : "",
    worthCalling: r.worth_calling,
    source: "api",
  };
}
