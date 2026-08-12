"use client";

import { useSyncExternalStore } from "react";

/**
 * URLのフラグメント(`#` 以降)を読む。
 *
 * QRトークンはフラグメントに置いている(サーバーに送信させないため。[lib/qr.ts](./qr.ts))。
 * ブラウザ側の外部状態なので、effect + setState ではなく購読で読む。
 * サーバーレンダー時は null。
 */
export function useHash(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getSnapshot(): string | null {
  const h = window.location.hash.slice(1);
  return h.length > 0 ? h : "";
}

function getServerSnapshot(): string | null {
  return null;
}
