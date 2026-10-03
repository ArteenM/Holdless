"use client";

import { useState } from "react";

export default function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Holdless", text, url });
      } catch {
        // user closed the share sheet
      }
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={share}
      className="min-h-16 w-full rounded-full bg-ink text-xl font-extrabold text-lime active:scale-[0.98]"
    >
      {copied ? "Link copied" : "Share my win"}
    </button>
  );
}
