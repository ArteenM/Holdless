"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { Line } from "@/lib/calls";
import { VIBES } from "@/lib/mock";
import { loadAccount } from "@/lib/account";
import { Bubble, Waveform, formatTime } from "./live-call";

// A browser voice conversation with the vibe's ElevenLabs agent. You play the
// rep. When it ends we hand over to /call/<conversationId>, which waits for
// ElevenLabs' analysis, stamps the Solana receipt and goes to /win.

export default function WebCall({ query }: { query: Record<string, string> }) {
  return (
    <ConversationProvider>
      <Conversation query={query} />
    </ConversationProvider>
  );
}

function Conversation({ query }: { query: Record<string, string> }) {
  const router = useRouter();
  const vibe = query.vibe || "relentless";
  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label ?? "Relentless";

  const [transcript, setTranscript] = useState<Line[]>([{ speaker: "system", text: `Calling ${query.company || "your provider"}…` }]);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ended, setEnded] = useState(false);
  const conversationId = useRef<string | null>(null);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const conversation = useConversation({
    onConnect: ({ conversationId: cid }) => {
      conversationId.current = cid;
    },
    onMessage: ({ message, role }) => {
      setTranscript((t) => [...t, { speaker: role === "agent" ? "agent" : "rep", text: message }]);
    },
    onError: (message) => {
      console.error("[web-call]", message);
      if (!conversationId.current) setError(message || "Couldn't connect");
    },
    onDisconnect: (details) => {
      const cid = conversationId.current;
      if (cid) {
        setEnded(true);
        router.replace(`/call/${cid}?vibe=${vibe}`);
      } else setError(details.reason === "error" ? details.message : "The call ended before it started");
    },
  });
  const { startSession, endSession, status, isSpeaking, isMuted, setMuted } = conversation;

  // Start once. React's dev-mode double effect must not open two sessions.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, account: loadAccount() }),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `signed-url ${res.status}`);
        startSession({
          signedUrl: data.signedUrl,
          dynamicVariables: data.dynamicVariables,
          overrides: data.overrides,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [query, startSession]);

  const live = status === "connected";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length]);

  const label = error
    ? "Couldn't start the call"
    : status === "connected"
      ? isSpeaking
        ? "Holdless is talking"
        : "Listening to the rep"
      : ended
        ? "Call ended"
        : "Connecting · allow the microphone";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex min-h-11 items-center font-mono text-sm text-muted">
          ← Home
        </Link>
        <span className="rounded-full border border-line px-3 py-1 font-mono text-xs">{vibeLabel} mode · live</span>
      </header>

      <section className="mt-6">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted">
          {live && <span className="size-2 animate-pulse rounded-full bg-lime" />}
          {label}
        </p>
        <p className="mt-1 text-6xl font-extrabold tabular-nums tracking-tight">{formatTime(seconds)}</p>
        <Waveform active={live} calm={!isSpeaking} />
      </section>

      {error && (
        <p className="mt-4 rounded-3xl bg-card p-4 font-mono text-xs text-muted" role="alert">
          {error}
        </p>
      )}

      <section aria-live="polite" className="mt-4 flex flex-1 flex-col gap-3 pb-40">
        {transcript.map((line, i) => (
          <Bubble key={i} {...line} />
        ))}
        <div ref={bottom} />
      </section>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink to-transparent px-4 pt-8 pb-6">
        <div className="mx-auto flex w-full max-w-md gap-3">
          {error ? (
            <>
              <Link
                href="/"
                className="flex min-h-16 flex-1 items-center justify-center rounded-full border-2 border-cream text-lg font-bold active:scale-[0.98]"
              >
                Back
              </Link>
              <button
                type="button"
                onClick={() => router.replace(`/call/demo-${Date.now()}?vibe=${vibe}`)}
                className="min-h-16 flex-1 rounded-full bg-lime text-lg font-extrabold text-ink active:scale-[0.98]"
              >
                Play demo call
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={isMuted}
                disabled={!live}
                onClick={() => setMuted(!isMuted)}
                className={`min-h-16 flex-1 rounded-full border-2 text-lg font-bold active:scale-[0.98] disabled:opacity-30 ${
                  isMuted ? "border-lime text-lime" : "border-cream"
                }`}
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                disabled={!live}
                onClick={() => endSession()}
                className="min-h-16 flex-1 rounded-full bg-lime text-lg font-extrabold text-ink active:scale-[0.98] disabled:opacity-30"
              >
                End call
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
