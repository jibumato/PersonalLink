"use client";

import { useState, useTransition } from "react";
import { saveDetail } from "@/app/actions/settings";

const FIELDS = ["本名", "誕生日", "SNS", "所属"] as const;

/**
 * F-2 Level 4(詳細)プロフィール。
 *
 * 全項目が任意。**空欄は保存しない**ので、書かなければ存在しないのと同じ。
 */
export function DetailForm({ detail }: { detail: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="stack"
      action={(form) =>
        start(async () => {
          const r = await saveDetail(form);
          setMessage(r.ok ? "保存しました" : "保存できませんでした");
        })
      }
    >
      {FIELDS.map((f) => (
        <label className="formrow" key={f}>
          <span>{f}</span>
          <input className="field" name={f} defaultValue={detail[f] ?? ""} maxLength={100} />
        </label>
      ))}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        保存
      </button>
      {message && <p className="hint hint-ok">{message}</p>}
    </form>
  );
}
