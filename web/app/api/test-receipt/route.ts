import { createHash } from "node:crypto";
import { stampReceipt } from "@/lib/solana";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Stamps a fake receipt on devnet so you can check the keypair and funding.
export async function GET() {
  try {
    const receipt = await stampReceipt({
      callId: `test-${Date.now()}`,
      transcriptHash: sha256("rep: I can do $25 off a month for 12 months."),
      promisesHash: sha256('[{"amount_mo":25,"months":12}]'),
      discount: 25,
      months: 12,
    });
    return Response.json(receipt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
