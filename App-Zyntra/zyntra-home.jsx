// zyntra-home.jsx — Dashboard / Home screen

function HomeScreen({ onModuleOpen, onGoNotifications }) {
  const kpis = [
    { title: 'Faturamento', value: 'R$ 1,24M', change: '+8,4%', up: true, color: Z.accent, spark: [70,90,80,110,100,130,120,145,155,170] },
    { title: 'Pedidos Abertos', value: '247', change: '+12 hoje', up: true, color: Z.green, spark: [40,52,48,65,60,74,70,82,78,90] },
    { title: 'Colaboradores', value: '184', sub: 'ativos hoje', color: Z.purple, spark: [180,181,182,181,183,182,184,183,184,184] },
    { title: 'Disponib. Estoque', value: '96%', change: '-2%', up: false, color: Z.yellow, spark: [99,98,97,99,96,98,97,96,97,96] },
  ];

  const resumo = [
    { label: 'NF-e emitidas hoje', value: '34', color: Z.green },
    { label: 'Compras pendentes', value: '8', color: Z.yellow },
    { label: 'Entregas em andamento', value: '22', color: Z.teal },
    { label: 'Ordens de produção', value: '15', color: Z.orange },
    { label: 'Aprovações aguardando', value: '5', color: Z.red },
  ];

  const atividade = [
    { msg: 'Pedido #4821 aprovado por Carlos S.', time: '09:32', dot: Z.green },
    { msg: 'NF-e #001204 emitida — R$ 12.540', time: '09:15', dot: Z.accent },
    { msg: 'Entrega #892 concluída em SP', time: '08:50', dot: Z.teal },
    { msg: 'PO-0431 aguardando aprovação', time: '08:22', dot: Z.yellow },
    { msg: 'Colaborador admitido: Ana Paula R.', time: '07:48', dot: Z.purple },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: Z.bg, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: Z.muted, fontFamily: Z.font, marginBottom: 2 }}>Bom dia,</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: Z.text, fontFamily: Z.font, letterSpacing: -0.3 }}>Administrador</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onGoNotifications} style={{ width: 38, height: 38, background: Z.card, border: `1px solid ${Z.border}`, borderRadius: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <IcBell s={18} c={Z.mutedLight}/>
              <div style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: Z.red, border: `1.5px solid ${Z.bg}` }}/>
            </button>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: `linear-gradient(135deg, ${Z.accent}, #7C3AED)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: Z.font }}>AD</div>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* KPI grid */}
        <div>
          <SectionLabel text="Visão Geral"/>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {kpis.map((k, i) => <KPICard key={i} {...k}/>)}
          </div>
        </div>

        {/* Resumo do dia */}
        <div>
          <SectionLabel text="Resumo do Dia"/>
          <ZCard style={{ overflow: 'hidden', padding: 0 }}>
            {resumo.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: i < resumo.length - 1 ? `1px solid ${Z.border}` : 'none' }}>
                <span style={{ fontSize: 13, color: Z.textSoft, fontFamily: Z.font }}>{r.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: r.color, fontFamily: Z.font }}>{r.value}</span>
              </div>
            ))}
          </ZCard>
        </div>

        {/* Módulos rápidos */}
        <div>
          <SectionLabel text="Módulos"/>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {MODULES.map(m => (
              <button key={m.id} onClick={() => onModuleOpen(m.id)} style={{
                background: Z.card, border: `1px solid ${Z.border}`, borderRadius: 14,
                padding: '12px 4px 10px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                transition: 'border-color 0.2s',
              }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: m.dim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ModIcon id={m.id} s={18} c={m.color}/>
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 600, color: Z.mutedLight, fontFamily: Z.font, textAlign: 'center', lineHeight: 1.3 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Atividade recente */}
        <div>
          <SectionLabel text="Atividade Recente"/>
          <ZCard style={{ overflow: 'hidden', padding: 0 }}>
            {atividade.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i < atividade.length - 1 ? `1px solid ${Z.border}` : 'none' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: a.dot, flexShrink: 0 }}/>
                <div style={{ flex: 1, fontSize: 12.5, color: Z.textSoft, fontFamily: Z.font, lineHeight: 1.4 }}>{a.msg}</div>
                <div style={{ fontSize: 11, color: Z.muted, fontFamily: Z.font, flexShrink: 0 }}>{a.time}</div>
              </div>
            ))}
          </ZCard>
        </div>

      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen });
