"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TRANSCRIPT, VIBES } from "@/lib/mock";

const LINE_MS = 2200;
const BARS = 32;

export default function LiveCall({ id, vibe }: { id: string; vibe: string }) {
  const [shown, setShown] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [takenOver, setTakenOver] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const done = shown >= TRANSCRIPT.length;
  const onHold = shown <= 2;
  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label ?? "Relentless";

  // Mock: reveal one transcript line at a time. Pauses while you've taken over.
  useEffect(() => {
    if (done || takenOver) return;
    const t = setTimeout(() => setShown((n) => n + 1), LINE_MS);
    return () => clearTimeout(t);
  }, [shown, done, takenOver]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [shown]);

  const status = done ? "Call ended" : takenOver ? "You're on the line" : onHold ? "On hold" : "Talking to Rogers";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex min-h-11 items-center font-mono text-sm text-muted">
          ← Home
        </Link>
        <span className="rounded-full border border-line px-3 py-1 font-mono text-xs">{vibeLabel} mode</span>
      </header>

      <section className="mt-6">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted">
          {!done && <span className="size-2 animate-pulse rounded-full bg-lime" />}
          {status}
        </p>
        <p className="mt-1 text-6xl font-extrabold tabular-nums tracking-tight">{formatTime(seconds)}</p>
        <Waveform active={!done} calm={onHold || takenOver} />
      </section>

      <section aria-live="polite" className="mt-4 flex flex-1 flex-col gap-3 pb-40">
        {TRANSCRIPT.slice(0, shown).map((line, i) => (
          <Bubble key={i} {...line} />
        ))}
        <div ref={bottom} />
      </section>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <div className="mx-auto flex w-full max-w-md gap-3">
          {done ? (
            <Link
              href={`/win/${id}`}
              className="flex min-h-16 flex-1 items-center justify-center rounded-full bg-lime text-xl font-extrabold text-ink active:scale-[0.98]"
            >
              See your win →
            </Link>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={takenOver}
                onClick={() => setTakenOver(true)}
                className={`min-h-16 flex-1 rounded-full border-2 text-lg font-bold active:scale-[0.98] ${
                  takenOver ? "border-lime text-lime" : "border-cream"
                }`}
              >
                {takenOver ? "You're live" : "Take over"}
              </button>
              <button
                type="button"
                onClick={() => setTakenOver(false)}
                className="min-h-16 flex-1 rounded-full bg-lime text-lg font-extrabold text-ink active:scale-[0.98]"
              >
                Let it cook
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Waveform({ active, calm }: { active: boolean; calm: boolean }) {
  return (
    <div className="mt-4 flex h-16 items-center gap-1" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className={`wave-bar h-full flex-1 rounded-full ${calm ? "bg-muted" : "bg-lime"}`}
          style={{
            animationDelay: `${(i * 137) % 900}ms`,
            animationDuration: calm ? "2.4s" : `${700 + ((i * 53) % 500)}ms`,
            animationPlayState: active ? "running" : "paused",
            opacity: active ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

function Bubble({ speaker, text, promise }: { speaker: string; text: string; promise?: boolean }) {
  if (speaker === "system") {
    return <p className="bubble-in py-1 text-center font-mono text-xs text-muted">{text}</p>;
  }
  const agent = speaker === "agent";
  return (
    <div className={`bubble-in flex flex-col ${agent ? "items-end" : "items-start"}`}>
      <span className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted">{agent ? "Holdless" : "Rep"}</span>
      <p
        className={`max-w-[85%] rounded-3xl px-4 py-3 text-lg leading-snug ${
          agent ? "rounded-br-md bg-lime text-ink" : "rounded-bl-md bg-card"
        }`}
      >
        {text}
      </p>
      {promise && (
        <span className="mt-1 rounded-full border border-lime px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-lime">
          Promise detected
        </span>
      )}
    </div>
  );
}

function formatTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
