"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LevelView } from "@/lib/level";
import { accept, propose, proposePermanentAction, revoke } from "@/app/actions/level";

/**
 * E-1 レベルゲージと機能リスト。
 *
 * **解放は提案 → 承諾、停止は1タップ**(D-5)。この非対称をそのまま画面に出す。
 * 停止に確認を挟まないのは、「やめたい」と思った瞬間にやめられることが
 * 安心の実体だから。誤タップは提案し直せば戻せる。
 */
export function LevelPanel({
  connectionId,
  levels,
  status,
  canAct,
}: {
  connectionId: string;
  levels: LevelView[];
  status: "active" | "grace" | "permanent" | "expired";
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? null : (r.error ?? "うまくいきませんでした"));
      if (r.ok) router.refresh();
    });
  }

  // レベルは積み上げではない。Lv.3 が準備中のまま Lv.4 だけ解放されることもあるので、
  // ゲージは**段階ごとの実際の状態**を映す。累積で塗ると解放していないものが点いてしまう
  const grantedAt = (n: number) =>
    n === 0 || levels.find((l) => l.level === n)?.granted === true;
  const openCount = [1, 2, 3, 4].filter(grantedAt).length;

  return (
    <section className="panel">
      <p className="eyebrow">Connection Level</p>

      <div className="gauge" aria-label={`解放済み ${openCount} / 4`}>
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} className={`gaugestep${grantedAt(n) ? " on" : ""}`}>
            {n}
          </span>
        ))}
      </div>

      <ul className="levellist">
        {levels.map((l) => (
          <li key={l.level}>
            <span className="grow">
              <span className="name">
                {l.granted ? "✅" : l.comingSoon ? "🔒" : "🔒"} {l.label}
              </span>
              <span className="sub">Lv.{l.level}</span>
            </span>

            {l.comingSoon && <span className="badge">準備中</span>}

            {!l.comingSoon && l.granted && l.level !== 1 && canAct && (
              <button
                type="button"
                className="linkbtn"
                disabled={pending}
                onClick={() => run(() => revoke(connectionId, l.level))}
              >
                共有を停止
              </button>
            )}

            {!l.comingSoon && !l.granted && l.awaitingMyAnswer && canAct && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending}
                onClick={() => run(() => accept(connectionId, l.level))}
              >
                承諾する
              </button>
            )}

            {!l.comingSoon && !l.granted && !l.awaitingMyAnswer && l.proposedByMe && (
              <span className="badge">提案中</span>
            )}

            {!l.comingSoon &&
              !l.granted &&
              !l.awaitingMyAnswer &&
              !l.proposedByMe &&
              canAct && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending || !l.canPropose}
                  onClick={() => run(() => propose(connectionId, l.level))}
                >
                  提案する
                </button>
              )}
          </li>
        ))}
      </ul>

      {status !== "permanent" && status !== "expired" && (
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await proposePermanentAction(connectionId);
                if (r.ok && !r.becamePermanent) {
                  setMessage("恒久化を提案しました。相手も選ぶと期限がなくなります。");
                }
                return r;
              })
            }
          >
            ♾ 恒久化を提案
          </button>
          <p className="hint">
            相手も「継続」を選ぶと期限がなくなります。<strong>提案したことは通知されません。</strong>
          </p>
        </div>
      )}

      {message && <p className="hint hint-error">{message}</p>}
    </section>
  );
}
