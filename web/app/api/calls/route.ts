import { startCall } from "@/lib/calls";

// POST /api/calls { company, service, province, startPrice, vibe } → { id, demo }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const call = await startCall({
    company: String(body.company ?? "Rogers"),
    service: String(body.service ?? "Internet"),
    province: String(body.province ?? "BC"),
    startPrice: Number(body.startPrice) || 96,
    vibe: String(body.vibe ?? "relentless"),
  });
  return Response.json(call);
}
