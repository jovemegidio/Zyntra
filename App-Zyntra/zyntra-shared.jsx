// zyntra-shared.jsx — Design tokens, icons, and base UI components

const Z = {
  bg: '#090C14',
  surface: '#0F1520',
  card: '#131A28',
  card2: '#1A2236',
  border: '#1E2A42',
  borderLight: '#253350',
  accent: '#3B82F6',
  accentDim: 'rgba(59,130,246,0.18)',
  accentGlow: 'rgba(59,130,246,0.10)',
  text: '#EEF2FF',
  textSoft: '#B8C4DC',
  muted: '#5A6882',
  mutedLight: '#8898B4',
  green: '#22C55E',
  greenDim: 'rgba(34,197,94,0.15)',
  red: '#EF4444',
  redDim: 'rgba(239,68,68,0.15)',
  yellow: '#F59E0B',
  yellowDim: 'rgba(245,158,11,0.15)',
  purple: '#A855F7',
  purpleDim: 'rgba(168,85,247,0.15)',
  teal: '#14B8A6',
  tealDim: 'rgba(20,184,166,0.15)',
  orange: '#F97316',
  orangeDim: 'rgba(249,115,22,0.15)',
  font: "'DM Sans', system-ui, sans-serif",
};

const MODULES = [
  { id: 'financeiro',   label: 'Financeiro',   color: Z.accent,  dim: Z.accentDim  },
  { id: 'vendas',       label: 'Vendas',        color: Z.green,   dim: Z.greenDim   },
  { id: 'rh',           label: 'RH',            color: Z.purple,  dim: Z.purpleDim  },
  { id: 'pcp',          label: 'PCP',           color: Z.yellow,  dim: Z.yellowDim  },
  { id: 'logistica',    label: 'Logística',     color: Z.teal,    dim: Z.tealDim    },
  { id: 'faturamento',  label: 'Faturamento',   color: Z.red,     dim: Z.redDim     },
  { id: 'compras',      label: 'Compras',       color: Z.orange,  dim: Z.orangeDim  },
];

// ── SVG Icons ────────────────────────────────────────────────────────────────
function IcHome({ s=22, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 12L12 3l9 9v9h-6v-5H9v5H3v-9z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}
function IcGrid({ s=22, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke={c} strokeWidth="1.8"/><rect x="13" y="3" width="8" height="8" rx="2" stroke={c} strokeWidth="1.8"/><rect x="3" y="13" width="8" height="8" rx="2" stroke={c} strokeWidth="1.8"/><rect x="13" y="13" width="8" height="8" rx="2" stroke={c} strokeWidth="1.8"/></svg>;
}
function IcBell({ s=22, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M6 10c0-3.314 2.686-6 6-6s6 2.686 6 6v4l2 2H4l2-2v-4z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/><path d="M10 20h4" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IcUser({ s=22, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.8"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IcBack({ s=20, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IcChev({ s=14, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IcSearch({ s=18, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={c} strokeWidth="1.8"/><path d="M16.5 16.5L21 21" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IcPlus({ s=18, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke={c} strokeWidth="2" strokeLinecap="round"/></svg>;
}
function IcFilter({ s=18, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 6h18M7 12h10M10 18h4" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IcTrendUp({ s=14, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 17l6-6 4 4 8-8" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IcTrendDown({ s=14, c='currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 7l6 6 4-4 8 8" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// Module SVG icons
function ModIcon({ id, s=20, c }) {
  const col = c || (MODULES.find(m=>m.id===id)||{color:Z.accent}).color;
  const icons = {
    financeiro: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={col} strokeWidth="1.8"/><path d="M12 7v1m0 8v1M9.5 9.5c0-1 1.1-1.5 2.5-1.5s2.5.7 2.5 1.8c0 1-1 1.7-2.5 1.7S9.5 12.2 9.5 13.2c0 1.1 1.1 1.8 2.5 1.8s2.5-.5 2.5-1.5" stroke={col} strokeWidth="1.6" strokeLinecap="round"/></svg>,
    vendas: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 17l5-5 4 4 9-9" stroke={col} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 7h5v5" stroke={col} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    rh: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="3.5" stroke={col} strokeWidth="1.7"/><path d="M2 19c0-3.5 3.1-6 7-6" stroke={col} strokeWidth="1.7" strokeLinecap="round"/><circle cx="17" cy="8" r="2.5" stroke={col} strokeWidth="1.6"/><path d="M22 19c0-2.8-2.2-5-5-5" stroke={col} strokeWidth="1.7" strokeLinecap="round"/></svg>,
    pcp: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke={col} strokeWidth="1.8"/><path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={col} strokeWidth="1.8" strokeLinecap="round"/></svg>,
    logistica: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="1" y="8" width="14" height="10" rx="2" stroke={col} strokeWidth="1.7"/><path d="M15 12h4l3 4v2h-7V12z" stroke={col} strokeWidth="1.7" strokeLinejoin="round"/><circle cx="5.5" cy="19.5" r="1.5" stroke={col} strokeWidth="1.5"/><circle cx="17.5" cy="19.5" r="1.5" stroke={col} strokeWidth="1.5"/></svg>,
    faturamento: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke={col} strokeWidth="1.7" strokeLinejoin="round"/><path d="M14 2v6h6M9 13h6M9 17h4" stroke={col} strokeWidth="1.6" strokeLinecap="round"/></svg>,
    compras: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6z" stroke={col} strokeWidth="1.7" strokeLinejoin="round"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0" stroke={col} strokeWidth="1.7" strokeLinecap="round"/></svg>,
  };
  return icons[id] || null;
}

// ── Base UI Components ────────────────────────────────────────────────────────
function ZCard({ children, style={}, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: Z.card, borderRadius: 16, border: `1px solid ${Z.border}`,
      cursor: onClick ? 'pointer' : 'default', ...style,
    }}>{children}</div>
  );
}

function ZBadge({ label, color, bg, size=11 }) {
  return (
    <span style={{ fontSize: size, fontWeight: 600, letterSpacing: 0.3, color, background: bg, padding: '3px 8px', borderRadius: 20, fontFamily: Z.font, whiteSpace: 'nowrap' }}>{label}</span>
  );
}

function ZDivider() {
  return <div style={{ height: 1, background: Z.border, margin: '0 16px' }}/>;
}

function ZRow({ label, value, valueColor, sub, last=false, onPress }) {
  return (
    <div onClick={onPress} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: last ? 'none' : `1px solid ${Z.border}`, cursor: onPress ? 'pointer' : 'default' }}>
      <div>
        <div style={{ fontSize: 14, color: Z.textSoft, fontFamily: Z.font }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: Z.muted, fontFamily: Z.font, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: valueColor || Z.text, fontFamily: Z.font }}>{value}</span>
        {onPress && <IcChev s={13} c={Z.muted}/>}
      </div>
    </div>
  );
}

function SparkLine({ data, color, h=36, w=90 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-((v-min)/range)*(h-6)-3}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function BarChart({ data, color, h=48, labels }) {
  const max = Math.max(...data) || 1;
  const bw = 22, gap = 8;
  const totalW = data.length * (bw + gap) - gap;
  return (
    <svg width="100%" height={h+20} viewBox={`0 0 ${totalW} ${h+20}`} preserveAspectRatio="xMidYMid meet">
      {data.map((v, i) => {
        const bh = Math.max((v/max)*(h-4), 3);
        const x = i*(bw+gap);
        const y = h-bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh} rx={4} fill={color} opacity={i===data.length-1 ? 1 : 0.45}/>
            {labels && <text x={x+bw/2} y={h+14} textAnchor="middle" fontSize="8" fill={Z.muted} fontFamily="DM Sans, sans-serif">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function KPICard({ title, value, sub, change, up, color, spark, style={} }) {
  return (
    <ZCard style={{ padding: '14px 14px 12px', ...style }}>
      <div style={{ fontSize: 10, color: Z.muted, fontFamily: Z.font, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, color: Z.text, fontFamily: Z.font, lineHeight: 1.1 }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: Z.muted, fontFamily: Z.font, marginTop: 2 }}>{sub}</div>}
          {change && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4, color: up ? Z.green : Z.red }}>
              {up ? <IcTrendUp s={11} c={Z.green}/> : <IcTrendDown s={11} c={Z.red}/>}
              <span style={{ fontSize: 11, fontWeight: 600, fontFamily: Z.font }}>{change}</span>
            </div>
          )}
        </div>
        {spark && <SparkLine data={spark} color={color} h={34} w={80}/>}
      </div>
    </ZCard>
  );
}

function ScreenHeader({ title, onBack, right, bg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 50, flexShrink: 0, background: bg || 'transparent' }}>
      {onBack ? (
        <button onClick={onBack} style={{ background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, color: Z.accent }}>
          <IcBack s={18} c={Z.accent}/>
          <span style={{ fontFamily: Z.font, fontSize: 15, fontWeight: 500, color: Z.accent }}>Voltar</span>
        </button>
      ) : <div style={{ width: 60 }}/>}
      <div style={{ fontSize: 16, fontWeight: 700, color: Z.text, fontFamily: Z.font }}>{title}</div>
      <div style={{ width: 60, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

function StatusPill({ label, color, bg }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '3px 8px', borderRadius: 20, fontFamily: Z.font, letterSpacing: 0.4 }}>{label}</span>;
}

function SectionLabel({ text }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: Z.muted, fontFamily: Z.font, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, paddingLeft: 2 }}>{text}</div>;
}

Object.assign(window, {
  Z, MODULES,
  IcHome, IcGrid, IcBell, IcUser, IcBack, IcChev, IcSearch, IcPlus, IcFilter,
  IcTrendUp, IcTrendDown, ModIcon,
  ZCard, ZBadge, ZDivider, ZRow, SparkLine, BarChart, KPICard,
  ScreenHeader, StatusPill, SectionLabel,
});
