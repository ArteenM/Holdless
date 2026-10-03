import { getCall, stampOnce } from "@/lib/calls";

// GET /api/calls/:id → the call so far. Once it's done, also stamps the receipt on Solana.
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]">) {
  const { id } = await ctx.params;
  try {
    const call = await getCall(id);
    const receipt = call.status === "done" && call.result ? await stampOnce(id, call.result) : null;
    return Response.json({ ...call, receipt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
