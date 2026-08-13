"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unblock } from "@/app/actions/safety";
import type { BlockedUser } from "@/lib/safety";

/**
 * F-2 ブロックリスト。
 *
 * 解除しても**ブロック中に届かなかったメッセージは配信されない**。
 * ここで明記しておかないと「解除したのに来ない」を不具合と受け取られる。
 */
export function BlockList({ items }: { items: BlockedUser[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="hint">ブロックしている相手はいません。</p>;
  }

  return (
    <>
      <ul className="rows">
        {items.map((b) => (
          <li key={b.userId}>
            <span className="grow">
              <span className="name">{b.displayName ?? `@${b.handle}`}</span>
              <span className="sub mono">@{b.handle}</span>
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await unblock(b.userId);
                  setDone("解除しました");
                  router.refresh();
                })
              }
            >
              解除
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        解除しても、ブロック中に相手が送ったメッセージは届きません。
      </p>
      {done && <p className="hint hint-ok">{done}</p>}
    </>
  );
}
