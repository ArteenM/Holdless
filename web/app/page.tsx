"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_FIELDS, DEMO_ACCOUNT, accountComplete, loadAccount, saveAccount, type Account } from "@/lib/account";
import { SAMPLE_BILLS, SAMPLE_SCANS, VIBES, type Scan, type Vibe } from "@/lib/mock";

export default function Home() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [vibe, setVibe] = useState<Vibe>("relentless");
  const [dialing, setDialing] = useState(false);
  const [account, setAccount] = useState<Account>(() => Object.fromEntries(Object.keys(DEMO_ACCOUNT).map((k) => [k, ""])) as Account);

  useEffect(() => {
    const saved = loadAccount();
    if (saved) setAccount(saved);
  }, []);

  const setField = (key: keyof Account, value: string) => setAccount((a) => ({ ...a, [key]: value }));

  const scanSeq = useRef(0);

  // Reads the bill through /api/scan (data service). The route already falls
  // back to sample values; this catch only covers our own server being down.
  async function startScan(input: { sample: string } | { file: File }, name: string) {
    const seq = ++scanSeq.current;
    setFileName(name);
    setScan(null);
    setScanning(true);

    const body = new FormData();
    if ("sample" in input) body.set("sample", input.sample);
    else body.set("file", input.file);

    let result: Scan;
    try {
      const res = await fetch("/api/scan", { method: "POST", body, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`/api/scan → ${res.status}`);
      result = await res.json();
    } catch {
      const id = "sample" in input ? input.sample : "rogers_internet";
      result = { ...SAMPLE_SCANS[id], source: "fallback" };
    }

    if (seq !== scanSeq.current) return; // a newer scan started meanwhile
    setScan(result);
    setScanning(false);
  }

  // Opens the live browser conversation; /call/new fetches the signed URL itself.
  function callForMe() {
    if (!scan || !accountComplete(account)) return;
    saveAccount(account);
    setDialing(true);
    const q = new URLSearchParams({
      vibe,
      company: scan.company,
      service: scan.service,
      province: scan.province,
      price: String(scan.startPrice),
      plan: scan.planName ?? "",
      years: account.yearsCustomer || String(scan.yearsCustomer ?? ""),
    });
    router.push(`/call/new?${q}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) startScan({ file }, file.name);
    e.target.value = ""; // picking the same file again should rescan
  }

  const detailsDone = accountComplete(account);
  const canCall = scan !== null && scan.worthCalling !== false && detailsDone;

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
        <StepLabel n={1}>Your bill</StepLabel>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-3 flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-line bg-card px-4 py-6 text-center transition active:scale-[0.99] hover:border-lime"
        >
          <span className="text-xl font-bold">{fileName ? "Upload a different bill" : "Upload a photo of your bill"}</span>
          <span className="font-mono text-xs text-muted">{fileName ?? "JPEG, PNG or PDF"}</span>
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
        </div>
      </section>

      {scanning && (
        <div className="mt-6 animate-pulse rounded-3xl bg-card p-6 font-mono text-sm text-muted">Reading your bill…</div>
      )}

      {scan && (
        <>
          {/* 2. Overpay */}
          <section className="bubble-in mt-6 rounded-3xl bg-card p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted">
              {scan.company} · {scan.service}
            </p>
            <p className="mt-3 text-2xl font-bold">{scan.headline}</p>
            {scan.overpayMo > 0 && (
              <p className="text-7xl font-extrabold leading-none tracking-tight text-lime">
                ${scan.overpayMo}
                <span className="text-3xl">/mo</span>
              </p>
            )}
            <p className="mt-4 leading-snug">{scan.detail}</p>
            {scan.bestTime && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 font-mono text-xs">
                <span className="size-2 rounded-full bg-lime" />
                {scan.bestTime}
              </p>
            )}
            {scan.source === "fallback" && (
              <p className="mt-4 font-mono text-xs text-muted">Sample numbers · couldn&apos;t reach live prices</p>
            )}
          </section>

          {/* 3. Vibe */}
          <section className="bubble-in mt-8">
            <StepLabel n={2}>Pick a vibe</StepLabel>
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
          </section>

          {/* 4. Account details */}
          <section className="bubble-in mt-8">
            <div className="flex items-center justify-between">
              <StepLabel n={3}>Account details</StepLabel>
              <button
                type="button"
                onClick={() => setAccount({ ...DEMO_ACCOUNT, yearsCustomer: String(scan.yearsCustomer ?? DEMO_ACCOUNT.yearsCustomer) })}
                className="min-h-11 rounded-full border border-line px-3 font-mono text-xs transition hover:border-lime active:scale-95"
              >
                Use demo details
              </button>
            </div>
            <p className="mt-2 text-sm leading-snug text-muted">
              Reps always ask to confirm the account, so we have everything ready. We never ask for passwords, PINs or
              security answers. If they insist, you get patched in to verify.
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
                      className="min-h-12 rounded-2xl border border-line bg-card px-4 text-base outline-none transition placeholder:text-muted/60 focus:border-lime"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* 5. Call */}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <button
          type="button"
          disabled={!canCall || dialing}
          onClick={callForMe}
          className="mx-auto block min-h-16 w-full max-w-md rounded-full bg-lime text-xl font-extrabold text-ink transition active:scale-[0.98] disabled:opacity-30"
        >
          {dialing
            ? "Dialing…"
            : scan && scan.worthCalling === false
              ? "Nothing to win here"
              : scan && !detailsDone
                ? "Add account details"
                : "Call for me"}
        </button>
      </div>
    </main>
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
