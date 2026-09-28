"use client";

// Hand-rolled SVG samples to compare 4 icon styles side-by-side without
// installing 3 extra icon packs. Same set: inbox, message, user, calendar,
// search, send, archive, alert.

const SVG_PROPS = (stroke: number) => ({
  width: 22, height: 22, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

function IconInbox({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function IconInboxDuotone({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" fill="currentColor" fillOpacity="0.18" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function IconMessage({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconUser({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}
function IconSearch({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IconSend({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
function IconArchive({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}
function IconAlert({ stroke }: { stroke: number }) {
  return (
    <svg {...SVG_PROPS(stroke)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}

const SET = [
  { name: "inbox",   Lin: IconInbox,   Duo: IconInboxDuotone },
  { name: "message", Lin: IconMessage, Duo: IconMessage },
  { name: "user",    Lin: IconUser,    Duo: IconUser },
  { name: "search",  Lin: IconSearch,  Duo: IconSearch },
  { name: "send",    Lin: IconSend,    Duo: IconSend },
  { name: "archive", Lin: IconArchive, Duo: IconArchive },
  { name: "alert",   Lin: IconAlert,   Duo: IconAlert },
];

const STYLES = [
  { id: "lucide",   label: "Lucide",   stroke: 2,    desc: "Linear · stroke 2px · padrão React/shadcn. Familiar mas saturado em training data." },
  { id: "phosphor", label: "Phosphor (duotone)", stroke: 1.5, desc: "Duotone · fill+stroke. Mais 'soft-tech', combina com a paleta calma." },
  { id: "iconoir",  label: "Iconoir",  stroke: 1.5,  desc: "Linear hairline · stroke 1.5px. Elegante, leve. Bom para densidade compacta." },
  { id: "tabler",   label: "Tabler",   stroke: 1.75, desc: "Linear médio · stroke 1.75px. Mais robusto que Iconoir, mais fino que Lucide." },
];

export function SectionIcons() {
  return (
    <div className="ds-section">
      <h2 className="ds-display">Iconografia</h2>
      <p className="ds-lede">
        Quatro estilos comparados lado a lado nos mesmos 7 ícones. SVGs simulam o estilo (stroke + fill)
        sem instalar 4 pacotes — a decisão é sobre <em>peso visual</em> e <em>combinação com a paleta</em>.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {STYLES.map((s) => (
          <div className="ds-card" key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{s.label}</div>
                <div style={{ fontSize: 12.5, color: "var(--ds-text-muted)", marginTop: 2 }}>{s.desc}</div>
              </div>
              {s.id === "phosphor" && <span className="ds-badge ds-badge--accent">recomendado</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
              {SET.map((ic) => {
                const Comp = s.id === "phosphor" ? ic.Duo : ic.Lin;
                return (
                  <div key={ic.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 12, border: "1px solid var(--ds-border)", borderRadius: 8 }}>
                    <div style={{ color: "var(--ds-accent)" }}>
                      <Comp stroke={s.stroke} />
                    </div>
                    <span className="ds-key">{ic.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="ds-card" style={{ marginTop: 24, borderLeft: "3px solid var(--ds-accent)" }}>
        <h3 style={{ marginTop: 0 }}>Recomendação</h3>
        <p style={{ fontSize: 13.5, color: "var(--ds-text-muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--ds-text)" }}>Phosphor (duotone)</strong> como default.
          Justificativa: (1) o fill discreto cria peso visual sem ruído, casando com o accent dessaturado;
          (2) o duotone diferencia o sistema de 80%+ dos CRMs que usam Lucide/Heroicons; (3) o pacote oferece
          variações <span className="ds-mono">regular / bold / fill</span> para compor estados (hover/active)
          sem trocar de ícone. Uso secundário: <strong style={{ color: "var(--ds-text)" }}>Tabler</strong> para
          densidade compacta onde o duotone fica pesado.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ds-text-muted)", marginTop: 8 }}>
          Lucide segue disponível para componentes shadcn já instalados — o objetivo é não ser
          a identidade icônica do produto.
        </p>
      </div>
    </div>
  );
}
