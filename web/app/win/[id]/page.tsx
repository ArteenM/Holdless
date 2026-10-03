import Link from "next/link";
import { getCall, type CallResult } from "@/lib/calls";
import { explorerUrl } from "@/lib/solana";
import ShareButton from "./share-button";

// Fallback when the call can't be read (e.g. ElevenLabs is down during the demo).
const FALLBACK: CallResult = {
  company: "Rogers",
  savedMo: 25,
  months: 12,
  savedTotal: 300,
  repId: "R4471",
  confirmation: "CNF-882913",
  transcriptSha256: "",
  promisesSha256: "",
};

export default async function WinPage(props: PageProps<"/win/[id]">) {
  const { id } = await props.params;
  const { tx } = await props.searchParams;
  const signature = typeof tx === "string" ? tx : null;

  const win = await getCall(id)
    .then((c) => c.result ?? FALLBACK)
    .catch(() => FALLBACK);
  const won = win.savedTotal > 0;

  return (
    <div className="flex flex-1 flex-col bg-lime text-ink">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-10 pb-8">
        <p className="font-mono text-xs uppercase tracking-widest">
          {won ? "Holdless won" : "Call finished"} · {win.company}
        </p>
        <h1 className="mt-3 text-8xl font-extrabold leading-[0.9] tracking-tight">
          ${win.savedTotal}
          <br />
          saved
        </h1>
        <p className="mt-4 text-xl font-semibold">
          {won
            ? `$${win.savedMo}/mo off for ${win.months} months. You never waited on hold.`
            : "No discount this time. Try again at the best time to call, or switch the vibe."}
        </p>

        <section className="mt-8 rounded-3xl bg-ink p-6 text-cream">
          <p className="font-mono text-xs uppercase tracking-widest text-muted">
            Receipt · {signature ? "stamped on Solana" : "not stamped yet"}
          </p>
          <dl className="mt-4 space-y-3 font-mono text-sm">
            <Row label="Promise" value={won ? `$${win.savedMo}/mo × ${win.months}` : "none"} />
            <Row label="Confirmation" value={win.confirmation ?? "—"} />
            <Row label="Rep ID" value={win.repId ?? "—"} />
            <Row label="Transcript" value={short(win.transcriptSha256)} />
            <Row label="Promises" value={short(win.promisesSha256)} />
            <Row label="Tx" value={signature ? short(signature) : "—"} />
          </dl>
          {signature && (
            <a
              href={explorerUrl(signature)}
              target="_blank"
              rel="noreferrer"
              className="mt-6 flex min-h-12 items-center justify-center rounded-full border-2 border-lime font-bold text-lime active:scale-[0.98]"
            >
              View on Solana Explorer ↗
            </a>
          )}
        </section>

        <div className="mt-auto flex flex-col gap-3 pt-8">
          {won && (
            <ShareButton text={`Holdless just saved me $${win.savedTotal} on ${win.company}. I never waited on hold.`} />
          )}
          <Link href="/" className="flex min-h-12 items-center justify-center font-mono text-sm underline">
            Lower another bill
          </Link>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function short(s: string) {
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s || "—";
}
