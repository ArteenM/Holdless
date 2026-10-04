import type { Account, CallContext } from "@/lib/account";
import { webSession } from "@/lib/calls";

// POST /api/signed-url  { query: {vibe, company, service, province, price, plan, years}, account?: Account }
// GET  /api/signed-url?vibe=&company=…  (no account details; demo fallback)
// → { signedUrl, dynamicVariables, overrides } for a browser conversation with the vibe's agent.
// Account details travel in the body, never in the URL.
// 503 if ElevenLabs isn't configured or reachable; the call page then offers the demo call.

async function start(
  q: URLSearchParams | Map<string, string>,
  account: Partial<Account> | null,
  context: Partial<CallContext> | null = null,
) {
  const get = (k: string) => q.get(k) ?? "";
  const company = get("company") || "Rogers";
  const service = get("service") || "Internet";
  const years = Number(account?.yearsCustomer || get("years"));

  try {
    const session = await webSession({
      vibe: get("vibe") || "relentless",
      company,
      service,
      province: get("province"),
      startPrice: Number(get("price")) || 96,
      planName: get("plan") || `${company} ${service}`,
      yearsCustomer: years > 0 ? years : null,
      account,
      kind: context?.kind ?? (get("kind") === "one_time" ? "one_time" : "monthly"),
      goal: context?.goal?.trim() || undefined,
      customStyle: context?.customStyle?.trim() || undefined,
    });
    return Response.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[signed-url] can't start a web conversation:", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return start(new URL(request.url).searchParams, null);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    query?: Record<string, string>;
    account?: Partial<Account>;
    context?: Partial<CallContext>;
  };
  return start(new Map(Object.entries(body.query ?? {})), body.account ?? null, body.context ?? null);
}
