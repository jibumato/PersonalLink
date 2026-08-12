import { HandleForm } from "./handle-form";

/** A-2 Universal ID取得。 */
export default function SignupIdPage() {
  return (
    <main className="shell">
      <div className="panel">
        <p className="eyebrow">Step 1 / 2</p>
        <h1>Universal IDを決める</h1>
        <p className="lede">
          あなたの公開IDです。あとから変更もできます(90日に1回)。
        </p>
        <div style={{ marginTop: "1.2rem" }}>
          <HandleForm />
        </div>
      </div>
      <div className="notice">
        本人確認(A-3)は方式が未定のため、現在はスキップされます。
        方式が決まり次第、この後ろに追加されます。
      </div>
    </main>
  );
}
