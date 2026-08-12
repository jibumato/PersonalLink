"use client";

import { useEffect, useRef } from "react";

/**
 * 背景のデータストリーム(docs/03-design-language.md §2)。
 *
 * フローフィールドに沿って粒子の流線を描く。ARグラス(Phase 6)では
 * ここが実世界になるため、UIは常にこの上に半透明で重なる前提で作る。
 */
const GLYPHS = "01アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF+#";

export function DataStream() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, t = 0, raf = 0;
    type P = { x: number; y: number; s: number; w: number; c: string; l: number };
    type G = { x: number; y: number; ch: string; a: number; s: number };
    let parts: P[] = [];
    let glyphs: G[] = [];

    const color = () => {
      const r = Math.random();
      if (r < 0.74) return "8,145,178";
      if (r < 0.86) return "5,150,105";
      if (r < 0.95) return "219,39,163";
      return "202,138,4";
    };
    const spawn = (): P => ({
      x: Math.random() * w,
      y: Math.random() * h,
      s: 0.4 + Math.random() * 1.3,
      w: Math.random() < 0.1 ? 1.8 : 0.9,
      c: color(),
      l: 80 + Math.random() * 260,
    });
    const spawnG = (): G => ({
      x: Math.random() * w,
      y: Math.random() * h,
      ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
      a: 0.05 + Math.random() * 0.09,
      s: 0.25 + Math.random() * 0.4,
    });
    const angle = (x: number, y: number) =>
      (Math.sin(x * 0.0016 + t * 0.22) +
        Math.cos(y * 0.0014 - t * 0.16) +
        Math.sin((x + y) * 0.0006 + t * 0.09)) *
      1.05;

    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#eef4f6";
      ctx.fillRect(0, 0, w, h);
      const n = Math.min(200, Math.round((w * h) / 13000));
      parts = Array.from({ length: n }, spawn);
      glyphs = Array.from({ length: Math.min(26, Math.round(n / 7)) }, spawnG);
    };

    const step = () => {
      t += 0.016;
      ctx.fillStyle = "rgba(238,244,246,.10)";
      ctx.fillRect(0, 0, w, h);
      for (const p of parts) {
        const a = angle(p.x, p.y);
        const nx = p.x + Math.cos(a) * p.s * 2.2;
        const ny = p.y + Math.sin(a) * p.s * 2.2;
        ctx.strokeStyle = `rgba(${p.c},.34)`;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx;
        p.y = ny;
        p.l -= 1;
        if (p.l < 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
          Object.assign(p, spawn());
        }
      }
      ctx.font = "11px ui-monospace,Consolas,monospace";
      for (const g of glyphs) {
        const a = angle(g.x, g.y);
        g.x += Math.cos(a) * g.s;
        g.y += Math.sin(a) * g.s + 0.15;
        if (g.y > h + 14 || g.x < -14 || g.x > w + 14) Object.assign(g, spawnG(), { y: -10 });
        ctx.fillStyle = `rgba(14,116,144,${g.a})`;
        ctx.fillText(g.ch, g.x, g.y);
      }
    };

    const loop = () => {
      step();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced) {
        // 動かさず、1枚の静止画として描く
        for (let i = 0; i < 180; i++) step();
        return;
      }
      if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      resize();
      start();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else start();
    };

    resize();
    start();
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas id="fx" ref={ref} aria-hidden="true" />;
}
