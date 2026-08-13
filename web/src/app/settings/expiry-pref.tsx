"use client";

import { useTransition } from "react";
import { setPreferredExpiryDays } from "@/app/actions/connect";

/** F-2 QRの既定期限(B-2 の期限チップの初期値)。 */
export function ExpiryPref({ current }: { current: number }) {
  const [pending, start] = useTransition();

  return (
    <div className="chips">
      {[1, 7, 30].map((d) => (
        <button
          key={d}
          type="button"
          className={`chip${d === current ? " on" : ""}`}
          disabled={pending}
          aria-pressed={d === current}
          onClick={() => start(() => setPreferredExpiryDays(d as 1 | 7 | 30))}
        >
          {d}日
        </button>
      ))}
    </div>
  );
}
