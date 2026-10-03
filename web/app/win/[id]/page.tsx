import { WIN, explorerTx } from "@/lib/mock";
import ShareButton from "./share-button";

export default async function WinPage(props: PageProps<"/win/[id]">) {
  await props.params; // the id will select the real call once /api/calls exists
  const win = WIN;

  return (
    <div className="flex flex-1 flex-col bg-lime text-ink">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-10 pb-8">
        <p className="font-mono text-xs uppercase tracking-widest">Holdless won · {win.company}</p>
        <h1 className="mt-3 text-8xl font-extrabold leading-[0.9] tracking-tight">
          ${win.savedTotal}
          <br />
          saved
        </h1>
        <p className="mt-4 text-xl font-semibold">
          ${win.savedMo}/mo off for {win.months} months. You never waited on hold.
        </p>

        <section className="mt-8 rounded-3xl bg-ink p-6 text-cream">
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Receipt · stamped on Solana</p>
          <dl className="mt-4 space-y-3 font-mono text-sm">
            <Row label="Promise" value={`$${win.savedMo}/mo × ${win.months}`} />
            <Row label="Confirmation" value={win.confirmation} />
            <Row label="Rep ID" value={win.repId} />
            <Row label="Transcript" value={short(win.transcriptSha256)} />
            <Row label="Promises" value={short(win.promisesSha256)} />
            <Row label="Tx" value={short(win.signature)} />
          </dl>
          <a
            href={explorerTx(win.signature)}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-12 items-center justify-center rounded-full border-2 border-lime font-bold text-lime active:scale-[0.98]"
          >
            View on Solana Explorer ↗
          </a>
        </section>

        <div className="mt-auto pt-8">
          <ShareButton text={`Holdless just saved me $${win.savedTotal} on ${win.company}. I never waited on hold.`} />
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
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}
