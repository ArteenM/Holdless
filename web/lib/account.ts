// The account details the negotiator needs so the rep can find and confirm the
// account. Kept in sessionStorage (never in the URL) and sent to
// /api/signed-url in the request body.
//
// Deliberately NOT collected: passwords, PINs, security answers, card numbers,
// SIN/government IDs or date of birth. If a company insists on those, the
// account holder gets patched in to verify.

export type Account = {
  fullName: string;
  phone: string; // phone number on the account
  email: string;
  address: string; // service address
  postalCode: string;
  accountNumber: string;
  yearsCustomer: string;
  contractEnd: string; // promo / contract end, optional
  walkAwayPrice: string; // most they'd accept paying, optional
  mustKeep: string; // things not to give up, optional
};

export const ACCOUNT_FIELDS: { key: keyof Account; label: string; placeholder: string; optional?: boolean; type?: string }[] = [
  { key: "fullName", label: "Full name on the account", placeholder: "Mehdi Ehdaei" },
  { key: "accountNumber", label: "Account number", placeholder: "On your bill, top right" },
  { key: "phone", label: "Phone number on the account", placeholder: "604-555-0142", type: "tel" },
  { key: "email", label: "Email on the account", placeholder: "you@example.com", type: "email" },
  { key: "address", label: "Service address", placeholder: "123 Main St, Surrey BC" },
  { key: "postalCode", label: "Postal code", placeholder: "V3T 0A1" },
  { key: "yearsCustomer", label: "Customer for (years)", placeholder: "6", type: "number" },
  { key: "contractEnd", label: "Contract / promo ends", placeholder: "e.g. March 2027", optional: true },
  { key: "walkAwayPrice", label: "Most you'd pay per month", placeholder: "e.g. 65", optional: true, type: "number" },
  { key: "mustKeep", label: "Don't give up", placeholder: "e.g. same speed, no new contract", optional: true },
];

// Demo-ready values for the Rogers sample bill (fictional 555 number).
export const DEMO_ACCOUNT: Account = {
  fullName: "Mehdi Ehdaei",
  phone: "604-555-0142",
  email: "mehdi@holdless.tech",
  address: "10153 King George Blvd, Surrey BC",
  postalCode: "V3T 2W1",
  accountNumber: "8204 1173 559",
  yearsCustomer: "6",
  contractEnd: "",
  walkAwayPrice: "65",
  mustKeep: "same internet speed, no new contract",
};

const KEY = "holdless_account";

export function loadAccount(): Account | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function saveAccount(a: Account) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private mode: the call still works with what the page passes */
  }
}

export const accountComplete = (a: Account) =>
  ACCOUNT_FIELDS.every((f) => f.optional || String(a[f.key] ?? "").trim() !== "");
