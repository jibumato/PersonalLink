"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { join, leave } from "@/app/actions/group";

/**
 * G-1 参加確認。
 *
 * **勝手に入れない。** 断っても他のメンバーには知らせない —
 * 参加していない人の不参加をわざわざ広める必要はない。
 */
export function GroupInvite({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await join(groupId);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        参加する
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await leave(groupId);
            router.push("/home");
          })
        }
      >
        参加しない
      </button>
      <p className="hint">「参加しない」を選んでも、ほかのメンバーには知らされません。</p>
      {error && <p className="hint hint-error">{error}</p>}
    </div>
  );
}
