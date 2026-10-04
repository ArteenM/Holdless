"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNT_FIELDS,
  CATEGORIES,
  COMPANIES,
  DEMO_ACCOUNT,
  accountComplete,
  loadAccount,
  loadCallContext,
  saveAccount,
  saveCallContext,
  type Account,
  type CallContext,
} from "@/lib/account";
import { SAMPLE_BILLS, SAMPLE_SCANS, VIBES, type Scan, type Vibe } from "@/lib/mock";

const EMPTY_ACCOUNT = Object.fromEntries(Object.keys(DEMO_ACCOUNT).map((k) => [k, ""])) as Account;
const EMPTY_BILL: CallContext = { company: "", category: "", price: "", kind: "monthly", plan: "", goal: "", customStyle: "" };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function Home() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [bill, setBill] = useState<CallContext>(EMPTY_BILL);
  const [otherCompany, setOtherCompany] = useState(false);
  const [vibe, setVibe] = useState<Vibe>("relentless");
  const [dialing, setDialing] = useState(false);
  const [account, setAccount] = useState<Account>(EMPTY_ACCOUNT);

  useEffect(() => {
    const saved = loadAccount();
    if (saved) setAccount(saved);
    const ctx = loadCallContext();
    if (ctx?.customStyle) setBill((b) => ({ ...b, customStyle: ctx.customStyle }));
  }, []);

  const setField = (key: keyof Account, value: string) => setAccount((a) => ({ ...a, [key]: value }));
  const setBillField = <K extends keyof CallContext>(key: K, value: CallContext[K]) => setBill((b) => ({ ...b, [key]: value }));

  const scanSeq = useRef(0);

  function applyScan(s: Scan) {
    setScan(s);
    const company = s.company || "";
    setOtherCompany(company !== "" && !COMPANIES.includes(company));
    setBill((b) => ({
      ...b,
      company,
      category: s.category || s.service || "",
      price: s.startPrice ? String(s.startPrice) : "",
      kind: s.kind ?? "monthly",
      plan: s.planName ?? "",
      goal:
        s.goal ||
        (s.kind === "one_time"
          ? ""
          : `Lower the monthly bill from ${money(s.startPrice)} without losing anything I have now.`),
    }));
  }

  async function startScan(input: { sample: string } | { file: File }, name: string) {
    const seq = ++scanSeq.current;
    setFileName(name);
    setScan(null);
    setScanError(null);
    setManual(false);
    setScanning(true);

    const body = new FormData();
    if ("sample" in input) body.set("sample", input.sample);
    else body.set("file", input.file);

    try {
      const res = await fetch("/api/scan", { method: "POST", body, signal: AbortSignal.timeout(60000) });
      const data = await res.json();
      if (seq !== scanSeq.current) return;
      if (!res.ok) {
        setScanError(data.error ?? "Couldn't read that. Fill in the details below.");
        setManual(true);
        setBill({ ...EMPTY_BILL, customStyle: bill.customStyle });
      } else applyScan(data as Scan);
    } catch {
      if (seq !== scanSeq.current) return;
      if ("sample" in input) applyScan({ ...SAMPLE_SCANS[input.sample], source: "fallback" });
      else {
        setScanError("Couldn't reach the analyzer. Fill in the details below.");
        setManual(true);
      }
    } finally {
      if (seq === scanSeq.current) setScanning(false);
    }
  }

  function enterManually() {
    scanSeq.current++;
    setScan(null);
    setScanError(null);
    setFileName(null);
    setScanning(false);
    setManual(true);
    setOtherCompany(false);
    setBill({ ...EMPTY_BILL, customStyle: bill.customStyle });
  }

  const billReady = bill.company.trim() !== "" && bill.goal.trim() !== "";
  const detailsDone = accountComplete(account);
  const showDetails = scan !== null || manual;
  const canCall = showDetails && billReady && detailsDone;

  function callForMe() {
    if (!canCall) return;
    saveAccount(account);
    saveCallContext(bill);
    setDialing(true);
    const q = new URLSearchParams({
      vibe,
      company: bill.company.trim(),
      service: bill.category || "Other",
      province: scan?.province || "BC",
      price: bill.price || "0",
      plan: bill.plan,
      years: account.yearsCustomer || String(scan?.yearsCustomer ?? ""),
      kind: bill.kind,
    });
    router.push(`/call/new?${q}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) startScan({ file }, file.name);
    e.target.value = "";
  }

  const unit = scan?.kind === "one_time" ? " back" : "/mo";
  const range =
    scan && (scan.savingsHigh ?? scan.overpayMo) > 0
      ? scan.savingsLow && scan.savingsHigh && scan.savingsLow !== scan.savingsHigh
        ? `${money(scan.savingsLow)}–${money(scan.savingsHigh)}`
        : money(scan.savingsHigh ?? scan.overpayMo)
      : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-6 pb-32">
      <header className="flex items-center justify-between">
        <span className="text-2xl font-extrabold tracking-tight">
          holdless<span className="text-lime">.</span>
        </span>
        <span className="font-mono text-xs uppercase tracking-widest text-muted">beta</span>
      </header>

      <h1 className="mt-10 text-5xl font-extrabold leading-[0.95] tracking-tight">
        We wait on hold.
        <br />
        <span className="text-lime">You don&apos;t.</span>
      </h1>

      {/* 1. Upload */}
      <section className="mt-10">
        <StepLabel n={1}>Your bill or receipt</StepLabel>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-3 flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-line bg-card px-4 py-6 text-center transition active:scale-[0.99] hover:border-lime"
        >
          <span className="text-xl font-bold">{fileName ? "Upload a different one" : "Upload a photo or PDF"}</span>
          <span className="font-mono text-xs text-muted">{fileName ?? "Phone, internet, hydro, gym, mechanic… anything"}</span>
        </button>
        <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="w-full font-mono text-xs text-muted">or try a sample</span>
          {SAMPLE_BILLS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => startScan({ sample: b.id }, `${b.label} (sample)`)}
              className="min-h-11 rounded-full border border-line px-4 font-mono text-sm transition hover:border-lime active:scale-95"
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            onClick={enterManually}
            className="min-h-11 rounded-full border border-dashed border-line px-4 font-mono text-sm transition hover:border-lime active:scale-95"
          >
            No bill? Type it in
          </button>
        </div>
      </section>

      {scanning && (
        <div className="mt-6 animate-pulse rounded-3xl bg-card p-6 font-mono text-sm text-muted">Reading your document…</div>
      )}

      {scanError && (
        <p className="mt-6 rounded-3xl bg-card p-5 text-sm leading-snug text-muted" role="alert">
          {scanError}
        </p>
      )}

      {/* Analysis */}
      {scan && (
        <section className="bubble-in mt-6 rounded-3xl bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted">
            {[scan.company, scan.category || scan.service].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-3 text-2xl font-bold">{scan.headline}</p>
          {range && scan.worthCalling !== false && (
            <p className="text-6xl font-extrabold leading-none tracking-tight text-lime">
              {range}
              <span className="text-2xl">{unit}</span>
            </p>
          )}
          {scan.detail && <p className="mt-4 leading-snug">{scan.detail}</p>}
          {scan.opportunities && scan.opportunities.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {scan.opportunities.map((o) => (
                <li key={o} className="flex gap-2 text-sm leading-snug">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lime" />
                  {o}
                </li>
              ))}
            </ul>
          )}
          {scan.bestTime && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 font-mono text-xs">
              <span className="size-2 rounded-full bg-lime" />
              {scan.bestTime}
            </p>
          )}
          {scan.source === "ai" && <p className="mt-4 font-mono text-xs text-muted">AI estimate · check the details below</p>}
          {scan.source === "fallback" && (
            <p className="mt-4 font-mono text-xs text-muted">Sample numbers · couldn&apos;t reach live prices</p>
          )}
        </section>
      )}

      {showDetails && (
        <>
          {/* 2. What's the call about */}
          <section className="bubble-in mt-8">
            <StepLabel n={2}>Who are we calling?</StepLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPANIES.map((c) => {
                const active = !otherCompany && bill.company === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setOtherCompany(false);
                      setBillField("company", c);
                    }}
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition active:scale-95 ${
                      active ? "border-lime bg-lime text-ink" : "border-line"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={otherCompany}
                onClick={() => {
                  setOtherCompany(true);
                  if (COMPANIES.includes(bill.company)) setBillField("company", "");
                }}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition active:scale-95 ${
                  otherCompany ? "border-lime bg-lime text-ink" : "border-dashed border-line"
                }`}
              >
                Other…
              </button>
            </div>
            {otherCompany && (
              <Field label="Company name">
                <input
                  autoFocus
                  value={bill.company}
                  onChange={(e) => setBillField("company", e.target.value)}
                  placeholder="e.g. Kal Tire, Dr. Lee Dental, Planet Fitness"
                  className={INPUT}
                />
              </Field>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="What it's for">
                <select value={bill.category} onChange={(e) => setBillField("category", e.target.value)} className={INPUT}>
                  <option value="">Choose…</option>
                  {[...new Set([bill.category, ...CATEGORIES].filter(Boolean))].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount ($)">
                <input
                  inputMode="decimal"
                  value={bill.price}
                  onChange={(e) => setBillField("price", e.target.value)}
                  placeholder="96"
                  className={INPUT}
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["monthly", "one_time"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={bill.kind === k}
                  onClick={() => setBillField("kind", k)}
                  className={`min-h-11 rounded-2xl border text-sm font-semibold transition ${
                    bill.kind === k ? "border-lime bg-lime text-ink" : "border-line"
                  }`}
                >
                  {k === "monthly" ? "Every month" : "One-time charge"}
                </button>
              ))}
            </div>
            <Field label="Plan / service (optional)">
              <input
                value={bill.plan}
                onChange={(e) => setBillField("plan", e.target.value)}
                placeholder="e.g. Ignite 1 Gbps, brake job, monthly membership"
                className={INPUT}
              />
            </Field>
            <Field label="What should we ask for?">
              <textarea
                rows={3}
                value={bill.goal}
                onChange={(e) => setBillField("goal", e.target.value)}
                placeholder="e.g. Waive the $120 diagnostic fee since I paid for the repair, or match the quote I got from another shop."
                className={`${INPUT} py-3`}
              />
            </Field>
          </section>

          {/* 3. Vibe */}
          <section className="bubble-in mt-8">
            <StepLabel n={3}>How should it sound?</StepLabel>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {VIBES.map((v) => {
                const active = v.id === vibe;
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setVibe(v.id)}
                    className={`min-h-20 rounded-2xl border-2 p-4 text-left transition active:scale-[0.98] ${
                      active ? "border-lime bg-lime text-ink" : "border-line bg-card"
                    }`}
                  >
                    <span className="block text-lg font-bold">{v.label}</span>
                    <span className={`block font-mono text-xs ${active ? "text-ink/70" : "text-muted"}`}>{v.blurb}</span>
                  </button>
                );
              })}
            </div>
            <Field label="Or tell it exactly how to act (optional)">
              <textarea
                rows={3}
                value={bill.customStyle}
                onChange={(e) => setBillField("customStyle", e.target.value)}
                placeholder="e.g. Be chill and funny, mention I'm a student, don't accept anything over $70, ask for a supervisor if they stall."
                className={`${INPUT} py-3`}
              />
            </Field>
          </section>

          {/* 4. Account details */}
          <section className="bubble-in mt-8">
            <div className="flex items-center justify-between">
              <StepLabel n={4}>Your details</StepLabel>
              <button
                type="button"
                onClick={() => setAccount({ ...DEMO_ACCOUNT, yearsCustomer: String(scan?.yearsCustomer ?? DEMO_ACCOUNT.yearsCustomer) })}
                className="min-h-11 rounded-full border border-line px-3 font-mono text-xs transition hover:border-lime active:scale-95"
              >
                Use demo details
              </button>
            </div>
            <p className="mt-2 text-sm leading-snug text-muted">
              Reps always ask to confirm who you are, so we have it ready. We never ask for passwords, PINs or security
              answers. If they insist, you get patched in.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {ACCOUNT_FIELDS.map((f) => {
                const wide = f.key === "fullName" || f.key === "address" || f.key === "email" || f.key === "mustKeep";
                return (
                  <label key={f.key} className={`flex flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
                    <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                      {f.label}
                      {f.optional && <span className="normal-case tracking-normal"> · optional</span>}
                    </span>
                    <input
                      type={f.type ?? "text"}
                      inputMode={f.type === "number" ? "numeric" : undefined}
                      value={account[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e) => setField(f.key, e.target.value)}
                      className={INPUT}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Call */}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <button
          type="button"
          disabled={!canCall || dialing}
          onClick={callForMe}
          className="mx-auto block min-h-16 w-full max-w-md rounded-full bg-lime text-xl font-extrabold text-ink transition active:scale-[0.98] disabled:opacity-30"
        >
          {dialing
            ? "Dialing…"
            : !showDetails
              ? "Upload a bill to start"
              : !billReady
                ? "Who and what to ask for?"
                : !detailsDone
                  ? "Add your details"
                  : `Call ${bill.company} for me`}
        </button>
      </div>
    </main>
  );
}

const INPUT =
  "min-h-12 w-full rounded-2xl border border-line bg-card px-4 text-base outline-none transition placeholder:text-muted/60 focus:border-lime";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</span>
      {children}
    </label>
  );
}

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted">
      <span className="flex size-5 items-center justify-center rounded-full bg-cream text-[10px] text-ink">{n}</span>
      {children}
    </h2>
  );
}
