"use client";

import { SPACING, RADII, BORDERS, SHADOWS, Z_INDEX, MOTION } from "../lib/tokens";

export function SectionTokens() {
  return (
    <div className="ds-section">
      <h2 className="ds-display">Tokens</h2>
      <p className="ds-lede">
        Foundation do sistema. Escala 4-base (4/8/12/16…) — granular o suficiente para densidade
        compacta sem fragmentação. Nada decorativo: cada token resolve um problema operacional.
      </p>

      <h3>Spacing scale (4-base)</h3>
      <div className="ds-card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {SPACING.map((s) => (
            <div key={s.token} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  width: s.px,
                  height: 24,
                  background: "var(--ds-accent)",
                  borderRadius: 2,
                  minWidth: 1,
                }}
              />
              <span className="ds-key">space-{s.token}</span>
              <span className="ds-val">{s.px}</span>
            </div>
          ))}
        </div>
      </div>

      <h3>Radius</h3>
      <div className="ds-card" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {RADII.map((r) => (
          <div key={r.token} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                width: "100%", aspectRatio: "1 / 1",
                background: "var(--ds-accent-soft)",
                border: "1px solid var(--ds-accent)",
                borderRadius: r.value,
              }}
            />
            <span className="ds-key">radius-{r.token}</span>
            <span className="ds-val">{r.value}</span>
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", lineHeight: 1.4 }}>{r.use}</span>
          </div>
        ))}
      </div>

      <h3>Borders</h3>
      <div className="ds-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {BORDERS.map((b) => (
          <div key={b.token} style={{ display: "grid", gridTemplateColumns: "120px 200px 1fr", gap: 16, alignItems: "center" }}>
            <div style={{ height: 32, borderRadius: 6, border: b.value, background: "var(--ds-surface)" }} />
            <span className="ds-key">border-{b.token}</span>
            <span style={{ fontSize: 12, color: "var(--ds-text-muted)" }}>{b.use}</span>
          </div>
        ))}
      </div>

      <h3>Shadows</h3>
      <div className="ds-card" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        {SHADOWS.map((s) => (
          <div key={s.token} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                height: 80,
                background: "var(--ds-surface)",
                borderRadius: 8,
                boxShadow: s.value,
                border: "1px solid var(--ds-border)",
              }}
            />
            <span className="ds-key">shadow-{s.token}</span>
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", lineHeight: 1.4 }}>{s.use}</span>
          </div>
        ))}
      </div>

      <h3>Z-index</h3>
      <div className="ds-card">
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ds-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <th style={{ padding: "8px 0" }}>Token</th>
              <th>Valor</th>
              <th>Uso</th>
            </tr>
          </thead>
          <tbody>
            {Z_INDEX.map((z) => (
              <tr key={z.token} style={{ borderTop: "1px solid var(--ds-border)" }}>
                <td className="ds-mono" style={{ padding: "10px 0" }}>z-{z.token}</td>
                <td className="ds-mono">{z.value}</td>
                <td style={{ color: "var(--ds-text-muted)" }}>{z.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Motion (referência rápida)</h3>
      <div className="ds-card" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {Object.entries(MOTION).map(([k, m]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="ds-key">motion-{k}</span>
            <span className="ds-val">{m.duration}</span>
            <span className="ds-val" style={{ fontSize: 10 }}>{m.easing}</span>
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>{m.use}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
