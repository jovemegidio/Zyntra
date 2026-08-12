// zyntra-nav.jsx — Bottom nav, Notifications, Profile screens

// ── Bottom Navigation ─────────────────────────────────────────
function BottomNav({ tab, onChange, notifCount }) {
  const tabs = [
    { id:'home', label:'Início', icon:(active) => <IcHome s={22} c={active ? Z.accent : Z.muted}/> },
    { id:'modules', label:'Módulos', icon:(active) => <IcGrid s={22} c={active ? Z.accent : Z.muted}/> },
    { id:'notifications', label:'Alertas', icon:(active) => <IcBell s={22} c={active ? Z.accent : Z.muted}/> },
    { id:'profile', label:'Perfil', icon:(active) => <IcUser s={22} c={active ? Z.accent : Z.muted}/> },
  ];

  return (
    <div style={{
      display:'flex', flexShrink:0,
      background:Z.surface, borderTop:`1px solid ${Z.border}`,
      paddingBottom:10,
    }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            flex:1, background:'none', border:'none', cursor:'pointer',
            display:'flex', flexDirection:'column', alignItems:'center',
            padding:'10px 0 4px', gap:3, position:'relative',
          }}>
            {t.id === 'notifications' && notifCount > 0 && (
              <div style={{
                position:'absolute', top:7, left:'calc(50% + 6px)',
                width:16, height:16, borderRadius:'50%',
                background:Z.red, border:`2px solid ${Z.surface}`,
                fontSize:9, color:'#fff', fontFamily:Z.font, fontWeight:700,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>{notifCount}</div>
            )}
            {t.icon(active)}
            <span style={{
              fontSize:10, fontFamily:Z.font, fontWeight:active ? 700 : 500,
              color:active ? Z.accent : Z.muted, letterSpacing:0.2,
            }}>{t.label}</span>
            {active && <div style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', width:20, height:3, borderRadius:2, background:Z.accent }}/>}
          </button>
        );
      })}
    </div>
  );
}

// ── Notificações ─────────────────────────────────────────────
function NotificacoesScreen() {
  const notifs = [
    { titulo:'Aprovação pendente', msg:'PO-0431 aguarda sua aprovação — R$ 42.000', tempo:'Agora', modulo:'Compras', mc:Z.orange, unread:true },
    { titulo:'NF-e rejeitada', msg:'NF-001207 foi rejeitada pela SEFAZ. Verifique.', tempo:'15 min', modulo:'Faturamento', mc:Z.red, unread:true },
    { titulo:'Pedido aprovado', msg:'Pedido #4821 aprovado por Carlos S. — R$ 12.540', tempo:'42 min', modulo:'Vendas', mc:Z.green, unread:true },
    { titulo:'OP-2403 concluída', msg:'Ordem de produção OP-2403 finalizada com sucesso.', tempo:'1h', modulo:'PCP', mc:Z.yellow, unread:false },
    { titulo:'Entrega concluída', msg:'ENT-892 entregue em São Paulo — SP.', tempo:'2h', modulo:'Logística', mc:Z.teal, unread:false },
    { titulo:'Colaborador admitido', msg:'Ana Paula R. — Analista de RH ingressou hoje.', tempo:'3h', modulo:'RH', mc:Z.purple, unread:false },
    { titulo:'Relatório gerado', msg:'DRE de Maio/2025 está disponível para download.', tempo:'5h', modulo:'Financeiro', mc:Z.accent, unread:false },
    { titulo:'Atualização do sistema', msg:'Zyntra v2.8.1 instalada. Confira as novidades.', tempo:'1d', modulo:'Sistema', mc:Z.mutedLight, unread:false },
  ];

  const [lidas, setLidas] = React.useState([]);
  const markAll = () => setLidas(notifs.map((_,i)=>i));

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <div style={{ padding:'14px 18px 10px', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:Z.text, fontFamily:Z.font, letterSpacing:-0.3 }}>Notificações</div>
          <div style={{ fontSize:13, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>{notifs.filter((n,i)=>n.unread && !lidas.includes(i)).length} não lidas</div>
        </div>
        <button onClick={markAll} style={{ background:'none', border:`1px solid ${Z.border}`, borderRadius:9, padding:'6px 12px', cursor:'pointer', fontSize:12, color:Z.accent, fontFamily:Z.font, fontWeight:500 }}>Marcar lidas</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'4px 14px 16px', display:'flex', flexDirection:'column', gap:8 }}>
        {notifs.map((n,i) => {
          const unread = n.unread && !lidas.includes(i);
          return (
            <div key={i} onClick={() => setLidas(l=>[...l, i])} style={{
              background: unread ? Z.card2 : Z.card,
              border:`1px solid ${unread ? Z.borderLight : Z.border}`,
              borderRadius:14, padding:'13px 14px', cursor:'pointer',
              display:'flex', gap:12, alignItems:'flex-start',
            }}>
              <div style={{ width:36, height:36, borderRadius:10, background:n.mc+'22', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <ModIcon id={n.modulo.toLowerCase()} s={17} c={n.mc}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{n.titulo}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, flexShrink:0, marginLeft:8 }}>{n.tempo}</div>
                </div>
                <div style={{ fontSize:12, color:Z.mutedLight, fontFamily:Z.font, lineHeight:1.45 }}>{n.msg}</div>
                <div style={{ marginTop:5 }}><ZBadge label={n.modulo} color={n.mc} bg={n.mc+'22'}/></div>
              </div>
              {unread && <div style={{ width:8, height:8, borderRadius:'50%', background:Z.accent, flexShrink:0, marginTop:4 }}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Perfil ────────────────────────────────────────────────────
function PerfilScreen({ onLogout }) {
  const [notifOn, setNotifOn] = React.useState(true);
  const [bioOn, setBioOn] = React.useState(true);
  const [darkOn, setDarkOn] = React.useState(true);

  const Toggle = ({ on, toggle }) => (
    <div onClick={toggle} style={{
      width:44, height:26, borderRadius:13, cursor:'pointer',
      background: on ? Z.accent : Z.border, position:'relative',
      transition:'background 0.2s', flexShrink:0,
    }}>
      <div style={{
        position:'absolute', top:3, left: on ? 21 : 3, width:20, height:20,
        borderRadius:'50%', background:'#fff', transition:'left 0.2s',
        boxShadow:'0 1px 4px rgba(0,0,0,0.3)',
      }}/>
    </div>
  );

  const Section = ({ title, children }) => (
    <div>
      <SectionLabel text={title}/>
      <ZCard style={{ overflow:'hidden', padding:0 }}>{children}</ZCard>
    </div>
  );

  const Row = ({ label, right, sub, last }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'13px 16px', borderBottom: last ? 'none' : `1px solid ${Z.border}` }}>
      <div>
        <div style={{ fontSize:14, color:Z.textSoft, fontFamily:Z.font }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <div style={{ padding:'14px 18px 10px', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:700, color:Z.text, fontFamily:Z.font, letterSpacing:-0.3 }}>Perfil</div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'4px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Avatar card */}
        <ZCard style={{ padding:'20px 16px', display:'flex', gap:14, alignItems:'center' }}>
          <div style={{ width:56, height:56, borderRadius:16, background:`linear-gradient(135deg, ${Z.accent}, #7C3AED)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:700, color:'#fff', fontFamily:Z.font, flexShrink:0 }}>AD</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:17, fontWeight:700, color:Z.text, fontFamily:Z.font }}>Administrador</div>
            <div style={{ fontSize:13, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>ti@aluforce.ind.br</div>
            <div style={{ marginTop:6 }}><ZBadge label="Super Admin" color={Z.accent} bg={Z.accentDim}/></div>
          </div>
          <IcChev s={14} c={Z.muted}/>
        </ZCard>

        {/* Conta */}
        <Section title="Conta">
          <Row label="Empresa" right={<span style={{ fontSize:13, color:Z.muted, fontFamily:Z.font }}>Aluforce</span>}/>
          <Row label="Versão do app" right={<span style={{ fontSize:13, color:Z.muted, fontFamily:Z.font }}>2.8.1</span>}/>
          <Row label="Alterar senha" right={<IcChev s={13} c={Z.muted}/>} last/>
        </Section>

        {/* Preferências */}
        <Section title="Preferências">
          <Row label="Notificações" sub="Alertas e atualizações" right={<Toggle on={notifOn} toggle={()=>setNotifOn(!notifOn)}/>}/>
          <Row label="Face ID / Touch ID" sub="Login biométrico" right={<Toggle on={bioOn} toggle={()=>setBioOn(!bioOn)}/>}/>
          <Row label="Tema escuro" right={<Toggle on={darkOn} toggle={()=>setDarkOn(!darkOn)}/>} last/>
        </Section>

        {/* Módulos */}
        <Section title="Acesso a Módulos">
          {MODULES.map((m,i)=>(
            <Row key={m.id} label={m.label} right={<div style={{ width:8, height:8, borderRadius:'50%', background:Z.green }}/>} last={i===MODULES.length-1}/>
          ))}
        </Section>

        {/* Sair */}
        <button onClick={onLogout} style={{
          width:'100%', padding:'14px 0', borderRadius:14, border:`1px solid ${Z.red}44`,
          background:Z.redDim, color:Z.red, fontSize:15, fontWeight:700, fontFamily:Z.font, cursor:'pointer',
        }}>Sair da conta</button>

        <div style={{ textAlign:'center', fontSize:11, color:Z.muted, fontFamily:Z.font, paddingBottom:4 }}>
          © 2026 Zyntra — Agência do Japa
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BottomNav, NotificacoesScreen, PerfilScreen });
