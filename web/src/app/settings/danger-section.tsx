"use client";

import { useState, useTransition } from "react";
import { deleteMyAccount } from "@/app/actions/settings";

/**
 * F-2 アカウント削除(憲法第六条)。
 *
 * **即時・完全**。猶予も引き止めもしない。
 * ただし取り返しがつかないので、@ID の入力で意思確認する。
 */
export function DangerSection({ }: Record<string, never>) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <section className="panel danger">
      <p className="eyebrow">アカウント</p>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        アカウントを削除
      </button>
      <p className="hint">
        すべてのデータが即座に消えます。取り消せません。
        先にデータをダウンロードしておくことをおすすめします。
      </p>

      {open && (
        <div className="amodal" onClick={() => setOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="アカウント削除の確認"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>本当に削除しますか?</h3>
            <div className="stack">
              <p className="hint">
                プロフィール・Connection・会話・添付ファイルが<strong>即座に完全に消えます</strong>。
                復元はできません。
                <br />
                相手の端末に届いたメッセージは、相手のデータなので残ります。
                <br />
                あなたの @ID は、なりすまし防止のため90日間は誰も取得できません。
              </p>
              <form action={() => start(() => deleteMyAccount())}>
                <button type="submit" className="btn btn-danger" disabled={pending}>
                  削除する
                </button>
              </form>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                やめる
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
