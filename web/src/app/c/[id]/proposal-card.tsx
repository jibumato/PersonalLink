"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { accept, dismiss } from "@/app/actions/level";

/**
 * C-2 承諾カード。相手からレベルの提案が来ているときだけ出る。
 *
 * **「今はしない」を並べて、同じ大きさで置く。** 承諾だけを目立たせると、
 * 断りにくさが「双方合意」を形だけのものにしてしまう(D-5)。
 * 断っても**相手には何も伝わらない**ことを、その場に書いておく。
 */
export function ProposalCard({
  connectionId,
  level,
  label,
}: {
  connectionId: string;
  level: number;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      await fn();
      setClosed(true);
      router.refresh();
    });
  }

  return (
    <div className="proposal">
      <p className="ptitle">
        {label}(Lv.{level})の解放が提案されています
      </p>
      <p className="hint">承諾すると、お互いに使えるようになります。</p>
      <div className="prow">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending}
          onClick={() => act(() => accept(connectionId, level))}
        >
          承諾する
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={() => act(() => dismiss(connectionId, level))}
        >
          今はしない
        </button>
      </div>
      <p className="hint">「今はしない」を選んでも、相手には通知されません。</p>
    </div>
  );
}
