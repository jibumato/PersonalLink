"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { block, report } from "@/app/actions/safety";
import { REPORT_CATEGORY_LABEL, type ReportCategory } from "@/lib/safety-labels";

/**
 * E-1 の危険域(F-1)。
 *
 * ブロックは**相手に一切通知されない**。そのことを画面にも明記する —
 * 「相手にバレる」と思われていると、必要な人が使えない。
 */
export function DangerZone({
  connectionId,
  name,
  blockedByMe,
}: {
  connectionId: string;
  name: string;
  blockedByMe: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<"block" | "report" | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [category, setCategory] = useState<ReportCategory>("harassment");
  const [detail, setDetail] = useState("");
  const [withMessages, setWithMessages] = useState(false);

  function doBlock() {
    startTransition(async () => {
      const r = await block(connectionId);
      setSheet(null);
      setDone(r.ok ? "ブロックしました。相手には通知されません。" : r.error);
      if (r.ok) router.refresh();
    });
  }

  function doReport() {
    startTransition(async () => {
      const r = await report(connectionId, { category, detail, withMessages });
      setSheet(null);
      setDone(r.ok ? "通報を受け付けました。" : r.error);
    });
  }

  return (
    <section className="panel danger">
      <p className="eyebrow">安全</p>

      {blockedByMe ? (
        <p className="hint">
          🚫 この相手をブロック中です。相手のメッセージは届きません。
          <br />
          解除は<a href="/settings">設定</a>から行えます。
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => setSheet("block")}
        >
          ブロック
        </button>
      )}

      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => setSheet("report")}
        style={{ marginTop: ".6rem" }}
      >
        通報
      </button>

      {done && <p className="hint hint-ok">{done}</p>}

      {sheet === "block" && (
        <div className="amodal" onClick={() => setSheet(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="ブロックの確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{name} をブロックしますか?</h3>
            <div className="stack">
              <p className="hint">
                これ以降、相手のメッセージは届かなくなります。
                <br />
                <strong>相手には通知されません。</strong>相手の画面は何も変わらず、
                送信は成功したように見えます。
                <br />
                解除しても、ブロック中のメッセージは届きません。
              </p>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending}
                onClick={doBlock}
              >
                ブロックする
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>
                やめる
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet === "report" && (
        <div className="amodal" onClick={() => setSheet(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="通報"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{name} を通報する</h3>
            <div className="stack">
              <label className="formrow">
                <span>種類</span>
                <select
                  className="field"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ReportCategory)}
                >
                  {Object.entries(REPORT_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>

              <label className="formrow">
                <span>詳細(任意)</span>
                <textarea
                  className="field"
                  rows={3}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="状況を書いていただけると助かります"
                />
              </label>

              {/* 既定OFF。同意がなければ本文は一切送らない(D-10) */}
              <label className="check">
                <input
                  type="checkbox"
                  checked={withMessages}
                  onChange={(e) => setWithMessages(e.target.checked)}
                />
                <span>
                  直近のメッセージ20件を運営に提供する
                  <br />
                  <span className="hint">
                    チェックしない場合、本文は一切送信されません。
                    取り消し済みのメッセージは、同意しても本文が残っていないため含まれません。
                  </span>
                </span>
              </label>

              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={doReport}
              >
                通報する
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>
                やめる
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
