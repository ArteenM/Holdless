"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CallView } from "@/lib/calls";
import type { Receipt } from "@/lib/solana";
import { VIBES } from "@/lib/mock";

const POLL_MS = 1500;
const MAX_ERRORS = 5;
const BARS = 32;

type Poll = CallView & { receipt: Receipt | null };

export default function LiveCall({ id, vibe }: { id: string; vibe: string }) {
  const router = useRouter();
  const [call, setCall] = useState<Poll | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [takenOver, setTakenOver] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const transcript = call?.transcript ?? [];
  const done = call?.status === "done" || call?.status === "failed";
  const onHold = transcript.filter((l) => l.speaker !== "system").length === 0;
  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label ?? "Relentless";

  // Poll the call. If the API keeps failing, switch to the demo call so the demo never stalls.
  useEffect(() => {
    let errors = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch(`/api/calls/${id}`, { signal: AbortSignal.timeout(30000), cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data: Poll = await res.json();
        if (stopped) return;
        errors = 0;
        setCall(data);
        if (data.status === "done") {
          const tx = data.receipt ? `?tx=${data.receipt.signature}` : "";
          timer = setTimeout(() => router.replace(`/win/${id}${tx}`), 1500);
          return;
        }
        if (data.status === "failed") return;
      } catch {
        if (++errors >= MAX_ERRORS && !id.startsWith("demo-")) {
          router.replace(`/call/demo-${Date.now()}?vibe=${vibe}`);
          return;
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, vibe, router]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length]);

  const status =
    call?.status === "failed"
      ? "Call failed"
      : done
        ? "Call ended · stamping your receipt"
        : call?.status === "processing"
          ? "Wrapping up"
          : takenOver
            ? "You're on the line"
            : onHold
              ? "Dialing · on hold"
              : "Talking to the rep";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex min-h-11 items-center font-mono text-sm text-muted">
          ← Home
        </Link>
        <span className="rounded-full border border-line px-3 py-1 font-mono text-xs">
          {vibeLabel} mode{call?.demo ? " · demo" : ""}
        </span>
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
        {transcript.map((line, i) => (
          <Bubble key={i} {...line} />
        ))}
        <div ref={bottom} />
      </section>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <div className="mx-auto flex w-full max-w-md gap-3">
          {call?.status === "failed" ? (
            <Link
              href="/"
              className="flex min-h-16 flex-1 items-center justify-center rounded-full border-2 border-cream text-xl font-bold active:scale-[0.98]"
            >
              Try again
            </Link>
          ) : done ? (
            <Link
              href={`/win/${id}${call?.receipt ? `?tx=${call.receipt.signature}` : ""}`}
              className="flex min-h-16 flex-1 items-center justify-center rounded-full bg-lime text-xl font-extrabold text-ink active:scale-[0.98]"
            >
              See your win →
            </Link>
          ) : !id.startsWith("demo-") ? (
            // A finished web conversation: ElevenLabs is still analysing it.
            <p className="flex min-h-16 flex-1 items-center justify-center rounded-full border-2 border-line font-mono text-sm text-muted">
              Reading the deal…
            </p>
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

export function Waveform({ active, calm }: { active: boolean; calm: boolean }) {
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

// ElevenLabs v3 voices write audio tags like "[cheerful]" or "[sighs]" into
// the text. They shape the voice; don't show them. (Display only: the stored
// transcript and its hash keep them.)
const AUDIO_TAG = /\[[a-z][a-z' -]*\]\s*/gi;
const stripAudioTags = (text: string) => text.replace(AUDIO_TAG, "").replace(/\s{2,}/g, " ").trim();

export function Bubble({ speaker, text: raw, promise }: { speaker: string; text: string; promise?: boolean }) {
  const text = stripAudioTags(raw);
  if (!text) return null;
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

export function formatTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
