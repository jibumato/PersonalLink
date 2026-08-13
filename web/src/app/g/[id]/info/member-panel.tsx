"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { destroy, invite, leave, remove } from "@/app/actions/group";
import type { GroupMemberView } from "@/lib/group";

type Candidate = { userId: string; handle: string; displayName: string | null };

/** G-2 メンバー管理。作成者だけがメンバー削除とグループ削除を持つ。 */
export function MemberPanel({
  groupId,
  members,
  candidates,
  isOwner,
  me,
}: {
  groupId: string;
  members: GroupMemberView[];
  candidates: Candidate[];
  isOwner: boolean;
  me: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "うまくいきませんでした");
      else (after ?? (() => router.refresh()))();
    });
  }

  return (
    <>
      <section className="panel">
        <p className="eyebrow">メンバー</p>
        <ul className="rows">
          {members.map((m) => (
            <li key={m.userId}>
              <span className="grow">
                <span className="name">
                  {m.displayName ?? `@${m.handle}`}
                  {m.isOwner && " 👑"}
                </span>
                <span className="sub mono">@{m.handle}</span>
              </span>
              {!m.joined && <span className="badge">招待中</span>}
              {isOwner && m.userId !== me && (
                <button
                  type="button"
                  className="linkbtn"
                  disabled={pending}
                  onClick={() => run(() => remove(groupId, m.userId))}
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {candidates.length > 0 && (
        <section className="panel">
          <p className="eyebrow">招待する</p>
          <p className="hint">つながっている相手だけを招待できます。</p>
          <ul className="rows">
            {candidates.map((c) => (
              <li key={c.userId}>
                <span className="grow">
                  <span className="name">{c.displayName ?? `@${c.handle}`}</span>
                  <span className="sub mono">@{c.handle}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending}
                  onClick={() => run(() => invite(groupId, c.userId))}
                >
                  招待
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel danger">
        <p className="eyebrow">このグループ</p>
        <div className="stack">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => run(() => leave(groupId), () => router.push("/home"))}
          >
            退出する
          </button>
          {isOwner && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              グループを削除
            </button>
          )}
        </div>
        {error && <p className="hint hint-error">{error}</p>}
      </section>

      {confirmDelete && (
        <div className="amodal" onClick={() => setConfirmDelete(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="グループ削除の確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>グループを削除しますか?</h3>
            <div className="stack">
              <p className="hint">
                全員の画面からこのグループと会話が消えます。<strong>元に戻せません。</strong>
              </p>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending}
                onClick={() => run(() => destroy(groupId), () => router.push("/home"))}
              >
                削除する
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDelete(false)}
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
