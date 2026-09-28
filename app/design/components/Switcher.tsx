"use client";

import { useVariant } from "../lib/variant-context";
import { PALETTES, TYPOS, DENSITIES } from "../lib/tokens";
import type { PaletteId, TypoId, DensityId } from "../lib/tokens";

export function Switcher() {
  const v = useVariant();
  return (
    <div className="ds-switcher">
      <select
        className="ds-pill-select"
        value={v.palette}
        aria-label="Paleta"
        onChange={(e) => v.setPalette(e.target.value as PaletteId)}
      >
        {Object.values(PALETTES).map((p) => (
          <option key={p.id} value={p.id}>Paleta · {p.name}</option>
        ))}
      </select>
      <select
        className="ds-pill-select"
        value={v.typo}
        aria-label="Tipografia"
        onChange={(e) => v.setTypo(e.target.value as TypoId)}
      >
        {Object.entries(TYPOS).map(([id, t]) => (
          <option key={id} value={id}>Tipo · {t.name}</option>
        ))}
      </select>
      <select
        className="ds-pill-select"
        value={v.density}
        aria-label="Densidade"
        onChange={(e) => v.setDensity(e.target.value as DensityId)}
      >
        {Object.entries(DENSITIES).map(([id, d]) => (
          <option key={id} value={id}>Densidade · {d.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="ds-icon-btn"
        aria-label="Alternar tema"
        onClick={() => v.setTheme(v.theme === "light" ? "dark" : "light")}
        title={v.theme === "light" ? "Trocar para escuro" : "Trocar para claro"}
      >
        {v.theme === "light" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
        )}
      </button>
    </div>
  );
}
