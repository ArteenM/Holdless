"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SAMPLE_BILLS, SAMPLE_SCANS, VIBES, type Scan, type Vibe } from "@/lib/mock";

export default function Home() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [vibe, setVibe] = useState<Vibe>("relentless");

  // Mock scan: a short delay, then a canned result.
  function startScan(sampleId: string, name: string) {
    setFileName(name);
    setScan(null);
    setScanning(true);
    setTimeout(() => {
      setScan(SAMPLE_SCANS[sampleId]);
      setScanning(false);
    }, 900);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) startScan("rogers_internet", file.name);
  }

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
              onClick={() => startScan(b.id, `${b.label} (sample)`)}
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
            <p className="text-7xl font-extrabold leading-none tracking-tight text-lime">
              ${scan.overpayMo}
              <span className="text-3xl">/mo</span>
            </p>
            <p className="mt-4 leading-snug">{scan.detail}</p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 font-mono text-xs">
              <span className="size-2 rounded-full bg-lime" />
              {scan.bestTime}
            </p>
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
        </>
      )}

      {/* 4. Call */}
      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <button
          type="button"
          disabled={!scan}
          onClick={() => router.push(`/call/demo?vibe=${vibe}`)}
          className="mx-auto block min-h-16 w-full max-w-md rounded-full bg-lime text-xl font-extrabold text-ink transition active:scale-[0.98] disabled:opacity-30"
        >
          Call for me
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
