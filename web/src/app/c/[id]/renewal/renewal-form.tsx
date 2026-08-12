"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { choose } from "@/app/actions/renewal";

/**
 * D-2 の選択ボタン。
 *
 * 「継続する」を主、「継続しない」を副として置く。ただし**副を隠さない** —
 * 残さない選択をしづらくすると「必要な期間だけつながる」という思想が形骸化する。
 */
export function RenewalForm({
  connectionId,
  myChoice,
  canChoose,
  status,
}: {
  connectionId: string;
  myChoice: "continue" | "end" | null;
  canChoose: boolean;
  status: "active" | "grace" | "permanent" | "expired";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(myChoice);
  const [message, setMessage] = useState<string | null>(null);

  function pick(choice: "continue" | "end") {
    startTransition(async () => {
      const r = await choose(connectionId, choice);
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setCurrent(choice);
      if (r.becamePermanent) {
        router.push(`/c/${connectionId}`);
        return;
      }
      setMessage(
        choice === "continue"
          ? "継続を選びました。相手の選択を待っています。"
          : // 実際には猶予終了まで残るが、そこを強調すると「まだ切れない」印象になる。
            // 相手からは区別できないことだけ伝える(D-16)
            "記録しました。相手には通知されません。",
      );
    });
  }

  if (!canChoose) {
    // 終了後に「24時間前から受け付けます」と出すと未来の話に読める。
    // 終わったものは終わったと伝える(D-4)
    return status === "expired" ? (
      <p className="hint">この接続はすでに終了しています。会話は残りますが、継続はできません。</p>
    ) : (
      <p className="hint">
        継続確認は期限の24時間前から受け付けます。それまでは通常どおりやり取りできます。
      </p>
    );
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => pick("continue")}
      >
        ♾ 継続する
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => pick("end")}
      >
        継続しない
      </button>

      {current === "continue" && (
        <p className="hint hint-ok">✓ 継続を選択済み — 相手の選択を待っています</p>
      )}
      {current === "end" && <p className="hint">✓ 継続しないを選択済み(変更できます)</p>}
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
