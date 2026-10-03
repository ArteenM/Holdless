import { createHash } from "node:crypto";
import { TRANSCRIPT } from "@/lib/mock";
import { stampReceipt, type Receipt } from "@/lib/solana";

// Server-only. Starts ElevenLabs outbound calls and turns a conversation into
// something the app can show. Every step falls back to a demo call so the
// golden path never stops.

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
  company: string;
  service: string;
  province: string;
  startPrice: number;
  vibe: string;
};

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

async function playbook(input: StartCallInput): Promise<Record<string, string | number>> {
  try {
    const q = new URLSearchParams({
      company: input.company,
      service: input.service.toLowerCase(),
      province: input.province,
      start_price: String(input.startPrice),
    });
    const p = await fetchJson<{
      playbook_text: string;
      target_price?: number;
      accept_at_or_below?: number;
      competitor_offer?: string | null;
    }>(`${DATA_API}/playbook?${q}`, {}, 4000);
    return {
      playbook: p.playbook_text,
      target_price: p.target_price ?? "",
      accept_at_or_below: p.accept_at_or_below ?? "",
      competitor_offer: p.competitor_offer ?? "",
    };
  } catch (err) {
    console.warn("[calls] playbook unavailable, using fallback:", err);
    return {
      playbook: `Ask for retention. Neighbours pay much less than $${input.startPrice}. Accept a discount of at least $20/mo for 12 months.`,
      target_price: "",
      accept_at_or_below: "",
      competitor_offer: "",
    };
  }
}

/** Returns the call id: the ElevenLabs conversation_id, or `demo-<ms>` if the real call can't start. */
export async function startCall(input: StartCallInput): Promise<{ id: string; demo: boolean }> {
  const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID, CALL_TO_NUMBER } = process.env;
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !ELEVENLABS_PHONE_NUMBER_ID || !CALL_TO_NUMBER) {
    console.warn("[calls] ElevenLabs env not set, starting a demo call");
    return demoCall();
  }

  try {
    const dynamic_variables = {
      company: input.company,
      service: input.service,
      province: input.province,
      start_price: input.startPrice,
      vibe: input.vibe,
      ...(await playbook(input)),
    };
    const res = await fetchJson<{ success: boolean; message: string; conversation_id: string | null }>(
      `${ELEVEN}/twilio/outbound-call`,
      {
        method: "POST",
        headers: elevenHeaders(),
        body: JSON.stringify({
          agent_id: ELEVENLABS_AGENT_ID,
          agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
          to_number: CALL_TO_NUMBER,
          conversation_initiation_client_data: { dynamic_variables },
        }),
      },
      10000,
    );
    if (!res.success || !res.conversation_id) throw new Error(res.message);
    return { id: res.conversation_id, demo: false };
  } catch (err) {
    console.error("[calls] outbound call failed, starting a demo call:", err);
    return demoCall();
  }
}

const demoCall = () => ({ id: `demo-${Date.now()}`, demo: true });

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

  // In an outbound call the "user" is the customer service rep.
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
