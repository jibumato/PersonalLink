"use client";

import { useState, useTransition } from "react";
import { create } from "@/app/actions/group";

type Candidate = { userId: string; handle: string; displayName: string | null };

/** G-1 のフォーム。IMEの扱いは A-2 と同じ(変換中は触らない)。 */
export function NewGroupForm({ candidates }: { candidates: Candidate[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form
      className="stack"
      action={(form) =>
        start(async () => {
          const r = await create(form);
          if (r && !r.ok) setError(r.error);
        })
      }
    >
      <label className="formrow">
        <span>グループ名</span>
        <input className="field" name="name" maxLength={40} required placeholder="展示めぐりの会" />
      </label>

      <p className="label">メンバー({picked.size}人を選択中)</p>
      <ul className="rows">
        {candidates.map((c) => (
          <li key={c.userId}>
            <label className="check" style={{ flex: 1 }}>
              <input
                type="checkbox"
                name="member"
                value={c.userId}
                checked={picked.has(c.userId)}
                onChange={() => toggle(c.userId)}
              />
              <span className="grow">
                <span className="name">{c.displayName ?? `@${c.handle}`}</span>
                <span className="sub mono">@{c.handle}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="hint">
        つながっている相手だけを招待できます。招待された人には参加するかどうかを聞きます。
      </p>

      <button type="submit" className="btn btn-primary" disabled={pending || picked.size === 0}>
        作成する
      </button>
      {error && <p className="hint hint-error">{error}</p>}
    </form>
  );
}
