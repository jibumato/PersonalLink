"use client";

import { useState, useTransition } from "react";
import { saveProfile } from "@/app/actions/settings";

/** F-2 Level 0(公開)プロフィール。 */
export function ProfileForm({ displayName, bio }: { displayName: string; bio: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="stack"
      action={(form) =>
        start(async () => {
          const r = await saveProfile(form);
          setMessage(r.ok ? "保存しました" : r.error);
        })
      }
    >
      <label className="formrow">
        <span>表示名</span>
        <input className="field" name="displayName" defaultValue={displayName} maxLength={40} required />
      </label>
      <label className="formrow">
        <span>ひとこと(50文字まで)</span>
        <input className="field" name="bio" defaultValue={bio} maxLength={50} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        保存
      </button>
      {message && <p className="hint hint-ok">{message}</p>}
    </form>
  );
}
