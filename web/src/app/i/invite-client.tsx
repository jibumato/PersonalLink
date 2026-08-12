"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveScan, type ScanOutcome } from "@/app/actions/connect";
import { useHash } from "@/lib/use-hash";

export function InviteClient() {
  const router = useRouter();
  const payload = useHash();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  useEffect(() => {
    if (!payload) return;
    let alive = true;
    void resolveScan(payload).then((r) => {
      if (!alive) return;
      if (r.kind === "confirm") router.replace(`/connect/confirm#${payload}`);
      else if (r.kind === "connected") router.replace("/home?already=1");
      else setOutcome(r);
    });
    return () => {
      alive = false;
    };
  }, [payload, router]);

  // payload が null(サーバー描画中)と "" (フラグメント無し)を区別する
  if (payload === "") {
    return <Failed message="QRの情報が読み取れませんでした" />;
  }

  if (outcome?.kind === "signup") {
    return (
      <div className="panel" style={{ textAlign: "center" }}>
        <p className="eyebrow">Personal Link</p>
        <h1>{outcome.ownerName} とつながる</h1>
        <p className="lede">
          アカウントを作るとそのまま接続されます。電話番号もメールも必要ありません。
        </p>
        <div className="stack" style={{ marginTop: "1.4rem" }}>
          <a href="/signup/id" className="btn btn-primary">アカウントを作る</a>
        </div>
      </div>
    );
  }

  if (outcome?.kind === "error") return <Failed message={outcome.message} />;

  return (
    <div className="panel" style={{ textAlign: "center" }}>
      <p className="eyebrow">Personal Link</p>
      <p className="lede">確認しています…</p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="panel" style={{ textAlign: "center" }}>
      <p className="eyebrow">Personal Link</p>
      <h1>接続できませんでした</h1>
      <p className="lede">{message}</p>
      <div className="stack" style={{ marginTop: "1.4rem" }}>
        <a href="/home" className="btn btn-secondary">ホームへ</a>
      </div>
    </div>
  );
}
