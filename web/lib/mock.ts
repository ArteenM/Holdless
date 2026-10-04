// Mock data: sample bills for the home screen, and the demo call's transcript.

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
  province: string;
  startPrice: number;
  planName?: string;
  yearsCustomer?: number;
  headline: string;
  overpayMo: number;
  detail: string;
  bestTime: string;
  // false when the data service says the bill isn't worth a call (fair price, no data)
  worthCalling?: boolean;
  // "fallback" when the data service couldn't be reached and these are the sample values
  source?: "api" | "fallback" | "ai" | "manual";
  // Generic analysis of any bill/receipt (not just telecom)
  category?: string; // "Internet", "Auto repair", "Gym", ...
  kind?: "monthly" | "one_time";
  savingsLow?: number;
  savingsHigh?: number;
  goal?: string; // what to ask for on the call
  opportunities?: string[];
};

// Fallback when the data service is unreachable: a cached copy of what its
// POST /bills/scan returns for each sample bill (seed data, offline mode).
export const SAMPLE_SCANS: Record<string, Scan> = {
  rogers_internet: {
    company: "Rogers",
    service: "Internet",
    province: "BC",
    startPrice: 96,
    planName: "Ignite Internet 1 Gbps",
    yearsCustomer: 6,
    headline: "You're overpaying",
    overpayMo: 41,
    detail: "People in Surrey pay $55 for the same internet plan. You pay $96.",
    bestTime: "Best time to call: Tue 9 am · avg hold 5 min",
  },
  bell_mobile: {
    company: "Bell",
    service: "Mobile",
    province: "ON",
    startPrice: 95,
    planName: "Essential 100 GB",
    yearsCustomer: 4,
    headline: "You're overpaying",
    overpayMo: 30,
    detail: "People in Toronto pay $65 for the same phone plan. You pay $95.",
    bestTime: "Best time to call: Tue 10 am · avg hold 6 min",
  },
  telus_mobile: {
    company: "TELUS",
    service: "Mobile",
    province: "BC",
    startPrice: 85,
    planName: "TELUS 100 GB",
    yearsCustomer: 3,
    headline: "You're overpaying",
    overpayMo: 25,
    detail: "People in Burnaby pay $60 for the same phone plan. You pay $85.",
    bestTime: "Best time to call: Wed 9 am · avg hold 4 min",
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
