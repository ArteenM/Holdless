import LiveCall from "./live-call";
import WebCall from "./web-call";

// /call/new?vibe=&company=…   starts a browser conversation (web-call.tsx)
// /call/<conversationId>      a finished web conversation: wait for analysis, stamp, go to /win
// /call/demo-<ms>             the mock transcript replay
export default async function CallPage(props: PageProps<"/call/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") query[k] = v;

  if (id === "new") return <WebCall query={query} />;
  return <LiveCall id={id} vibe={query.vibe ?? "relentless"} />;
}
