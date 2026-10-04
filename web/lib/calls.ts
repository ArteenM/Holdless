import { createHash } from "node:crypto";
import { TRANSCRIPT } from "@/lib/mock";
import type { Account } from "@/lib/account";
import { FIRST_MESSAGE, competitorLine, fillTemplate, systemPrompt } from "@/lib/prompts";
import { stampReceipt, type Receipt } from "@/lib/solana";

// Server-only. Prepares ElevenLabs browser (web) conversations and turns a
// finished conversation into something the app can show. Every step falls back
// to a demo call so the golden path never stops.

const ELEVEN = "https://api.elevenlabs.io/v1/convai";
const DATA_API = process.env.DATA_API_URL || "http://localhost:8100";
const DEMO_LINE_MS = 2200;

export type Line = { speaker: "agent" | "rep" | "system"; text: string; promise?: boolean };

export type CallResult = {
  company: string;
  savedMo: number;
  months: number;
  savedTotal: number;
  repId: string | null;
  confirmation: string | null;
  transcriptSha256: string;
  promisesSha256: string;
};

export type CallView = {
  id: string;
  demo: boolean;
  status: "live" | "processing" | "done" | "failed";
  transcript: Line[];
  result: CallResult | null;
};

export type StartCallInput = {
  vibe: string;
  company: string;
  service: string; // "Internet" | "Mobile"
  province: string;
  startPrice: number;
  planName: string;
  yearsCustomer: number | null;
  account?: Partial<Account> | null;
};

// The dynamic variables the negotiator agents' prompts use.
export type DynamicVariables = {
  user_name: string;
  company: string;
  plan_type: string;
  plan_name: string;
  years_customer: number | string;
  current_price: number;
  competitor_name: string;
  competitor_price: number | string;
  task: string;
};

// overrides replace the agent's dashboard prompt and first message, so every
// vibe's agent behaves as the Holdless negotiator. The agent must allow these
// overrides (ElevenLabs agent → Security → Overrides).
export type WebSession = {
  signedUrl: string;
  dynamicVariables: DynamicVariables;
  overrides: { agent: { prompt: { prompt: string }; firstMessage: string } };
};

// Whose bill it is when no account details were sent (demo fallback).
const DEFAULT_NAME = "Mehdi Ehdaei";
const nameOf = (input: StartCallInput) => input.account?.fullName?.trim() || DEFAULT_NAME;

// ---------------------------------------------------------------- helpers

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

const elevenHeaders = () => ({
  "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
  "Content-Type": "application/json",
});

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Sorted keys, no spaces: same convention as the data service's promises_canonical.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function buildResult(
  company: string,
  transcript: Line[],
  p: { savedMo: number; months: number; repId: string | null; confirmation: string | null },
): CallResult {
  const spoken = transcript.filter((l) => l.speaker !== "system").map((l) => ({ speaker: l.speaker, text: l.text }));
  const promises = { amount_mo: p.savedMo, confirmation_number: p.confirmation, months: p.months, rep_id: p.repId };
  return {
    company,
    ...p,
    savedTotal: Math.round(p.savedMo * p.months),
    transcriptSha256: sha256(canonical(spoken)),
    promisesSha256: sha256(canonical(promises)),
  };
}

// ---------------------------------------------------------------- start

type Playbook = {
  playbook_text: string;
  target_price?: number | null;
  accept_at_or_below?: number | null;
  competitor_offer?: { provider: string; price: number } | null;
};

async function playbook(input: StartCallInput): Promise<Playbook | null> {
  try {
    const q = new URLSearchParams({
      company: input.company,
      service: input.service.toLowerCase(),
      province: input.province,
      start_price: String(input.startPrice),
    });
    return await fetchJson<Playbook>(`${DATA_API}/playbook?${q}`, {}, 4000);
  } catch (err) {
    console.warn("[calls] playbook unavailable, using fallback:", err);
    return null;
  }
}

function dynamicVariables(input: StartCallInput, p: Playbook | null): DynamicVariables {
  const money = (n: number) => `$${Math.round(n)}`;
  const goal =
    p?.target_price && p?.accept_at_or_below
      ? `Aim for ${money(p.target_price)}/mo and accept ${money(p.accept_at_or_below)}/mo or less.`
      : "Accept a discount of at least $20/mo for 12 months.";
  return {
    user_name: nameOf(input),
    company: input.company,
    plan_type: input.service.toLowerCase(),
    plan_name: input.planName,
    years_customer: input.yearsCustomer ?? "several",
    current_price: input.startPrice,
    competitor_name: p?.competitor_offer?.provider ?? "another provider",
    competitor_price: p?.competitor_offer ? Math.round(p.competitor_offer.price) : "",
    task:
      `Get ${nameOf(input)}'s ${input.company} ${input.service.toLowerCase()} bill lowered from ${money(input.startPrice)}/mo. ${goal} ` +
      "Before ending the call, get the rep's ID and a confirmation number. " +
      (p?.playbook_text ?? "Ask for the retention department and mention that neighbours pay much less."),
  };
}

// Prompt-only variables from the account details form. "not on file" keeps the
// agent from inventing anything that wasn't provided.
function accountVars(input: StartCallInput): Record<string, string> {
  const a = input.account ?? {};
  const v = (x?: string) => (x && x.trim() ? x.trim() : "not on file");
  const full = nameOf(input);
  return {
    first_name: full.split(/\s+/)[0],
    account_number: v(a.accountNumber),
    phone: v(a.phone),
    email: v(a.email),
    address: v(a.address),
    postal_code: v(a.postalCode),
    contract_line: a.contractEnd?.trim() ? `Contract or promo ends: ${a.contractEnd.trim()}` : "No contract end date on file",
    walk_away_line: a.walkAwayPrice?.trim()
      ? `${full.split(/\s+/)[0]} would happily pay $${a.walkAwayPrice.trim()} a month or less. Push below that if you can.`
      : "",
    must_keep_line: a.mustKeep?.trim() ? `Don't give up: ${a.mustKeep.trim()}.` : "",
  };
}

/** A signed URL for the vibe's agent plus the variables to start it with. Throws if ElevenLabs isn't set up. */
export async function webSession(input: StartCallInput): Promise<WebSession> {
  const agentId = process.env[`EL_AGENT_${input.vibe.toUpperCase()}`];
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");
  if (!agentId) throw new Error(`EL_AGENT_${input.vibe.toUpperCase()} is not set`);

  const [signed, p] = await Promise.all([
    fetchJson<{ signed_url: string }>(
      `${ELEVEN}/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: elevenHeaders() },
    ),
    playbook(input),
  ]);
  const vars = dynamicVariables(input, p);
  return {
    signedUrl: signed.signed_url,
    dynamicVariables: vars,
    overrides: {
      agent: {
        prompt: {
          prompt: fillTemplate(systemPrompt(input.vibe), {
            ...vars,
            ...accountVars(input),
            competitor_line: competitorLine(vars.competitor_name, vars.competitor_price),
          }),
        },
        firstMessage: fillTemplate(FIRST_MESSAGE, { ...vars, ...accountVars(input) }),
      },
    },
  };
}

// ---------------------------------------------------------------- poll

export const isDemo = (id: string) => id.startsWith("demo-");

export async function getCall(id: string): Promise<CallView> {
  return isDemo(id) ? getDemoCall(id) : getElevenCall(id);
}

// The demo call replays the mock transcript based on how long ago it started,
// so it needs no server state.
function getDemoCall(id: string): CallView {
  const started = Number(id.slice("demo-".length)) || Date.now();
  const shown = Math.min(TRANSCRIPT.length, 1 + Math.floor((Date.now() - started) / DEMO_LINE_MS));
  const transcript = TRANSCRIPT.slice(0, shown);
  const done = shown >= TRANSCRIPT.length;
  return {
    id,
    demo: true,
    status: done ? "done" : "live",
    transcript,
    result: done
      ? buildResult("Rogers", transcript, { savedMo: 25, months: 12, repId: "R4471", confirmation: "CNF-882913" })
      : null,
  };
}

type Conversation = {
  status: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript: { role: "user" | "agent"; message?: string | null }[];
  analysis?: { data_collection_results?: Record<string, { value?: unknown }> } | null;
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> } | null;
};

async function getElevenCall(id: string): Promise<CallView> {
  const c = await fetchJson<Conversation>(`${ELEVEN}/conversations/${encodeURIComponent(id)}`, {
    headers: elevenHeaders(),
  });

  // The "user" side of the conversation plays the customer service rep.
  const transcript: Line[] = c.transcript
    .filter((t) => t.message)
    .map((t) => ({ speaker: t.role === "agent" ? "agent" : "rep", text: t.message as string }));

  const status = c.status === "done" ? "done" : c.status === "failed" ? "failed" : c.status === "processing" ? "processing" : "live";
  if (status !== "done") return { id, demo: false, status, transcript, result: null };

  // Data collection fields configured on the ElevenLabs agent (see CLAUDE.md).
  const dc = c.analysis?.data_collection_results ?? {};
  const value = (k: string) => dc[k]?.value;
  const num = (k: string) => {
    const n = Number(String(value(k) ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const str = (k: string) => (value(k) == null || value(k) === "" ? null : String(value(k)));
  const company = String(c.conversation_initiation_client_data?.dynamic_variables?.company ?? "your provider");

  return {
    id,
    demo: false,
    status,
    transcript,
    result: buildResult(company, transcript, {
      savedMo: num("discount_mo"),
      months: num("months") || 12,
      repId: str("rep_id"),
      confirmation: str("confirmation_number"),
    }),
  };
}

// ---------------------------------------------------------------- receipt

// One stamp per call per server instance, even if the page polls while it's in flight.
const stamps = new Map<string, Promise<Receipt | null>>();

export function stampOnce(id: string, result: CallResult): Promise<Receipt | null> {
  if (!stamps.has(id)) {
    stamps.set(
      id,
      stampReceipt({
        callId: id,
        transcriptHash: result.transcriptSha256,
        promisesHash: result.promisesSha256,
        discount: result.savedMo,
        months: result.months,
      }).catch((err) => {
        console.error("[calls] receipt stamp failed:", err);
        return null;
      }),
    );
  }
  return stamps.get(id)!;
}
