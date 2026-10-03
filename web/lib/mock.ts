// Mock data for the three screens. Swap for Arteen's API + /api/calls later.

export type Vibe = "polite" | "relentless" | "lawyer" | "grandma";

export const VIBES: { id: Vibe; label: string; blurb: string }[] = [
  { id: "polite", label: "Polite", blurb: "Kind, patient, firm" },
  { id: "relentless", label: "Relentless", blurb: "Won't take no" },
  { id: "lawyer", label: "Lawyer", blurb: "Cites the contract" },
  { id: "grandma", label: "Grandma", blurb: "Sweet. Unstoppable." },
];

export type Scan = {
  company: string;
  service: string;
  headline: string;
  overpayMo: number;
  detail: string;
  bestTime: string;
};

// Shaped like the data service's POST /bills/scan response.
export const SAMPLE_SCANS: Record<string, Scan> = {
  rogers_internet: {
    company: "Rogers",
    service: "Internet",
    headline: "You're overpaying",
    overpayMo: 41,
    detail: "People in Surrey pay $55 for the same internet plan. You pay $96.",
    bestTime: "Best time to call: now · avg hold 4 min",
  },
  bell_mobile: {
    company: "Bell",
    service: "Mobile",
    headline: "You're overpaying",
    overpayMo: 28,
    detail: "People in Ontario pay $57 for the same 100 GB plan. You pay $85.",
    bestTime: "Best time to call: Tue 9 am · avg hold 6 min",
  },
  telus_mobile: {
    company: "Telus",
    service: "Mobile",
    headline: "You're overpaying",
    overpayMo: 19,
    detail: "People in Alberta pay $60 for the same 50 GB plan. You pay $79.",
    bestTime: "Best time to call: now · avg hold 3 min",
  },
};

export const SAMPLE_BILLS = [
  { id: "rogers_internet", label: "Rogers Internet" },
  { id: "bell_mobile", label: "Bell Mobile" },
  { id: "telus_mobile", label: "Telus Mobile" },
];

export type Line = {
  speaker: "agent" | "rep" | "system";
  text: string;
  promise?: boolean;
};

export const TRANSCRIPT: Line[] = [
  { speaker: "system", text: "Dialing Rogers · 1-888-764-3771" },
  { speaker: "system", text: "On hold. Holdless is waiting so you don't have to." },
  { speaker: "rep", text: "Thanks for calling Rogers, this is Dana. How can I help?" },
  { speaker: "agent", text: "Hi Dana. I'm calling for Mehdi about the gigabit internet plan. He's paying $96 a month." },
  { speaker: "agent", text: "Neighbours in Surrey are paying $55 for the same speed, and Telus is offering $60. He'd like to stay, but not at $96." },
  { speaker: "rep", text: "Let me see what I can do. I can do $5 off for three months." },
  { speaker: "agent", text: "Appreciate it, but that's still $36 above market. Can you check retention offers?" },
  { speaker: "rep", text: "One moment… Okay. I've got approval for $25 off a month, for 12 months.", promise: true },
  { speaker: "agent", text: "That works. Can I get a confirmation number and your rep ID?" },
  { speaker: "rep", text: "Sure. Confirmation CNF-882913, rep ID R4471.", promise: true },
  { speaker: "agent", text: "Perfect. Thanks Dana, have a great day." },
  { speaker: "system", text: "Call ended · 14 min 32 s" },
];

export const WIN = {
  company: "Rogers",
  savedTotal: 300,
  savedMo: 25,
  months: 12,
  repId: "R4471",
  confirmation: "CNF-882913",
  transcriptSha256: "9f2c1a7e4b0d83e65c1f7a29d4e0b6c38a1f5e27d90c4b6a13e8f72c5d0a9b41",
  promisesSha256: "3b7e90d14c2a8f65e1d07b93a4c5f28e6d1b0a79c3e4f852b6a0d17e9c2f4a83",
  signature: "5VfYhxqQ8kE7mZr3TnW2cJpL9sBdG4aUeX6yHo1RkN8vMtFqP2wZ7jCnA3bD5gSxLuE9rKhT1yVmQ6oWpJ4fBc",
};

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
