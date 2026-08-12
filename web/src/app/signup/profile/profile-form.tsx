"use client";

import { useActionState } from "react";
import { saveProfile, type FormState } from "@/app/actions/auth";

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProfile, {});

  return (
    <form action={action} className="stack">
      <div>
        <label className="label" htmlFor="displayName">
          表示名(本名でなくてOK)
        </label>
        {/* 日本語で入力される欄。値は送信時にだけ読むので、変換中に触れる処理は入れない */}
        <input
          id="displayName"
          name="displayName"
          className="field"
          defaultValue={defaultName}
          placeholder="さとし"
          maxLength={30}
          required
          autoComplete="off"
        />
      </div>
      <div>
        <label className="label" htmlFor="bio">
          ひとこと(任意)
        </label>
        <input
          id="bio"
          name="bio"
          className="field"
          placeholder="カメラと登山が好きです"
          maxLength={50}
          autoComplete="off"
        />
      </div>
      {state.error && <p className="hint hint-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "保存中…" : "はじめる"}
      </button>
    </form>
  );
}
