import LiveCall from "./live-call";

export default async function CallPage(props: PageProps<"/call/[id]">) {
  const { id } = await props.params;
  const { vibe } = await props.searchParams;
  return <LiveCall id={id} vibe={typeof vibe === "string" ? vibe : "relentless"} />;
}
