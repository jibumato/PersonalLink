"use client";

import { useActionState } from "react";
import { devLogin, type FormState } from "@/app/actions/auth";

export function DevLoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(devLogin, {});

  return (
    <form action={action} className="stack">
      <div className="handle-row">
        <span className="at" aria-hidden="true">@</span>
        <input
          name="handle"
          className="field"
          placeholder="satoshi"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>
      {state.error && <p className="hint hint-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
