// zyntra-modules.jsx — All 7 module screens + modules grid

// ── Financeiro ────────────────────────────────────────────────
function FinanceiroScreen({ onBack }) {
  const meses = ['Jul','Ago','Set','Out','Nov','Dez'];
  const rec = [82,95,88,110,98,124];
  const pag = [60,72,65,80,74,91];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Financeiro" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Saldo cards */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[
            { label:'Saldo', value:'R$ 342K', color:Z.text },
            { label:'A Receber', value:'R$ 124K', color:Z.green },
            { label:'A Pagar', value:'R$ 91K', color:Z.red },
          ].map((c,i) => (
            <ZCard key={i} style={{ padding:'12px 10px', textAlign:'center' }}>
              <div style={{ fontSize:9.5, color:Z.muted, fontFamily:Z.font, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:5 }}>{c.label}</div>
              <div style={{ fontSize:13, fontWeight:700, color:c.color, fontFamily:Z.font }}>{c.value}</div>
            </ZCard>
          ))}
        </div>

        {/* Fluxo de caixa */}
        <div>
          <SectionLabel text="Fluxo de Caixa — 6 meses"/>
          <ZCard style={{ padding:'14px 14px 8px' }}>
            <div style={{ display:'flex', gap:16, marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}><div style={{ width:8, height:8, borderRadius:2, background:Z.accent }}/><span style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>Receita</span></div>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}><div style={{ width:8, height:8, borderRadius:2, background:Z.red }}/><span style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>Despesa</span></div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'flex-end', height:80 }}>
              {meses.map((m,i) => (
                <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <div style={{ width:'100%', display:'flex', gap:2, alignItems:'flex-end', height:60 }}>
                    <div style={{ flex:1, background:Z.accent, borderRadius:'3px 3px 0 0', height:`${(rec[i]/124)*60}px`, opacity:0.85 }}/>
                    <div style={{ flex:1, background:Z.red, borderRadius:'3px 3px 0 0', height:`${(pag[i]/124)*60}px`, opacity:0.7 }}/>
                  </div>
                  <div style={{ fontSize:9, color:Z.muted, fontFamily:Z.font }}>{m}</div>
                </div>
              ))}
            </div>
          </ZCard>
        </div>

        {/* Contas a Receber */}
        <div>
          <SectionLabel text="Contas a Receber"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { cli:'Empresa Alpha Ltda', venc:'03/06', valor:'R$ 28.400', status:'Vencendo', sc:Z.yellow, sd:Z.yellowDim },
              { cli:'Grupo Beta S.A.', venc:'10/06', valor:'R$ 15.200', status:'A Vencer', sc:Z.green, sd:Z.greenDim },
              { cli:'Ind. Gama Ltda', venc:'18/06', valor:'R$ 42.000', status:'A Vencer', sc:Z.green, sd:Z.greenDim },
              { cli:'Com. Delta Eireli', venc:'28/05', valor:'R$ 9.800', status:'Vencida', sc:Z.red, sd:Z.redDim },
            ].map((r,i,a) => (
              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{r.cli}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>Venc: {r.venc}</div>
                </div>
                <div style={{ textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{r.valor}</div>
                  <StatusPill label={r.status} color={r.sc} bg={r.sd}/>
                </div>
              </div>
            ))}
          </ZCard>
        </div>

        {/* DRE Resumo */}
        <div>
          <SectionLabel text="DRE — Dez/2025"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { label:'Receita Bruta', value:'R$ 1.240.000', color:Z.text },
              { label:'(-) Deduções', value:'- R$ 124.000', color:Z.red },
              { label:'Receita Líquida', value:'R$ 1.116.000', color:Z.text },
              { label:'(-) CMV', value:'- R$ 620.000', color:Z.red },
              { label:'Lucro Bruto', value:'R$ 496.000', color:Z.green },
              { label:'(-) Despesas Op.', value:'- R$ 248.000', color:Z.red },
              { label:'Lucro Líquido', value:'R$ 248.000', color:Z.accent },
            ].map((r,i,a) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'10px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none', background: r.label.includes('Lucro') && !r.label.includes('-') ? Z.accentGlow : 'transparent' }}>
                <span style={{ fontSize:13, color:Z.textSoft, fontFamily:Z.font }}>{r.label}</span>
                <span style={{ fontSize:13, fontWeight:600, color:r.color, fontFamily:Z.font }}>{r.value}</span>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── Vendas ────────────────────────────────────────────────────
function VendasScreen({ onBack }) {
  const [busca, setBusca] = React.useState('');
  const pedidos = [
    { num:'#4821', cli:'Alpha Ltda', valor:'R$ 12.540', status:'Aprovado', sc:Z.green, sd:Z.greenDim, data:'30/05' },
    { num:'#4820', cli:'Beta S.A.', valor:'R$ 8.200', status:'Em análise', sc:Z.yellow, sd:Z.yellowDim, data:'29/05' },
    { num:'#4819', cli:'Gama Eireli', valor:'R$ 34.800', status:'Aprovado', sc:Z.green, sd:Z.greenDim, data:'29/05' },
    { num:'#4818', cli:'Delta Corp', valor:'R$ 5.100', status:'Cancelado', sc:Z.red, sd:Z.redDim, data:'28/05' },
    { num:'#4817', cli:'Épsilon Ind.', valor:'R$ 19.700', status:'Entregue', sc:Z.teal, sd:Z.tealDim, data:'27/05' },
  ].filter(p => p.cli.toLowerCase().includes(busca.toLowerCase()) || p.num.includes(busca));

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Vendas" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <KPICard title="Faturado/Mês" value="R$ 892K" change="+11%" up={true} color={Z.green} spark={[60,75,70,88,82,95,90,105,98,112]}/>
          <KPICard title="Meta" value="82%" sub="R$ 1,09M meta" color={Z.accent} spark={[50,55,60,62,65,68,72,75,78,82]}/>
        </div>

        {/* Meta progress */}
        <ZCard style={{ padding:'14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:13, color:Z.textSoft, fontFamily:Z.font }}>Meta mensal — Junho</span>
            <span style={{ fontSize:13, fontWeight:700, color:Z.accent, fontFamily:Z.font }}>82%</span>
          </div>
          <div style={{ height:8, background:Z.surface, borderRadius:8, overflow:'hidden' }}>
            <div style={{ width:'82%', height:'100%', borderRadius:8, background:`linear-gradient(90deg, ${Z.accent}, ${Z.green})` }}/>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
            <span style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>R$ 892.000 realizado</span>
            <span style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>R$ 1.090.000 meta</span>
          </div>
        </ZCard>

        {/* Funil */}
        <div>
          <SectionLabel text="Funil de Vendas"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { label:'Prospecção', value:420, color:Z.mutedLight },
              { label:'Qualificação', value:280, color:Z.accent },
              { label:'Proposta', value:140, color:Z.yellow },
              { label:'Negociação', value:72, color:Z.orange },
              { label:'Fechamento', value:38, color:Z.green },
            ].map((f,i,a) => (
              <div key={i} style={{ padding:'10px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                  <span style={{ fontSize:12, color:Z.textSoft, fontFamily:Z.font }}>{f.label}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:f.color, fontFamily:Z.font }}>{f.value}</span>
                </div>
                <div style={{ height:5, background:Z.surface, borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:`${(f.value/420)*100}%`, height:'100%', background:f.color, borderRadius:4 }}/>
                </div>
              </div>
            ))}
          </ZCard>
        </div>

        {/* Pedidos */}
        <div>
          <SectionLabel text="Pedidos Recentes"/>
          <div style={{ display:'flex', background:Z.surface, borderRadius:11, padding:'10px 12px', gap:8, marginBottom:10, border:`1px solid ${Z.border}` }}>
            <IcSearch s={16} c={Z.muted}/>
            <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar pedido ou cliente..." style={{ flex:1, background:'none', border:'none', outline:'none', fontSize:13, color:Z.text, fontFamily:Z.font }}/>
          </div>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {pedidos.map((p,i,a) => (
              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{p.num} — {p.cli}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>{p.data}</div>
                </div>
                <div style={{ textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{p.valor}</div>
                  <StatusPill label={p.status} color={p.sc} bg={p.sd}/>
                </div>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── RH ────────────────────────────────────────────────────────
function RHScreen({ onBack }) {
  const cols = [
    { nome:'Ana Paula R.', cargo:'Analista de RH', dept:'RH', status:'Presente', sc:Z.green, sd:Z.greenDim },
    { nome:'Carlos Santos', cargo:'Gerente Comercial', dept:'Vendas', status:'Presente', sc:Z.green, sd:Z.greenDim },
    { nome:'Fernanda Lima', cargo:'Operadora de PCP', dept:'PCP', status:'Férias', sc:Z.accent, sd:Z.accentDim },
    { nome:'Ricardo Moura', cargo:'Motorista', dept:'Logística', status:'Em rota', sc:Z.teal, sd:Z.tealDim },
    { nome:'Juliana Costa', cargo:'Assist. Financeiro', dept:'Financeiro', status:'Ausente', sc:Z.red, sd:Z.redDim },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Recursos Humanos" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[
            { label:'Total', value:'184', color:Z.text },
            { label:'Presentes', value:'171', color:Z.green },
            { label:'Ausentes', value:'13', color:Z.red },
          ].map((c,i) => (
            <ZCard key={i} style={{ padding:'12px 10px', textAlign:'center' }}>
              <div style={{ fontSize:9.5, color:Z.muted, fontFamily:Z.font, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>{c.label}</div>
              <div style={{ fontSize:20, fontWeight:700, color:c.color, fontFamily:Z.font }}>{c.value}</div>
            </ZCard>
          ))}
        </div>

        {/* Ponto do dia */}
        <div>
          <SectionLabel text="Ponto Eletrônico — Hoje"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { label:'Entrada normal (até 08:05)', value:'152', color:Z.green },
              { label:'Atraso (após 08:05)', value:'12', color:Z.yellow },
              { label:'Falta justificada', value:'8', color:Z.orange },
              { label:'Falta não justificada', value:'5', color:Z.red },
              { label:'Home office', value:'7', color:Z.accent },
            ].map((r,i,a) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <span style={{ fontSize:12.5, color:Z.textSoft, fontFamily:Z.font }}>{r.label}</span>
                <span style={{ fontSize:15, fontWeight:700, color:r.color, fontFamily:Z.font }}>{r.value}</span>
              </div>
            ))}
          </ZCard>
        </div>

        {/* Colaboradores */}
        <div>
          <SectionLabel text="Colaboradores"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {cols.map((c,i,a) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg, ${Z.card2}, ${Z.border})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:Z.accent, fontFamily:Z.font, flexShrink:0 }}>
                  {c.nome.split(' ').map(n=>n[0]).slice(0,2).join('')}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.nome}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>{c.cargo} · {c.dept}</div>
                </div>
                <StatusPill label={c.status} color={c.sc} bg={c.sd}/>
              </div>
            ))}
          </ZCard>
        </div>

        {/* Aniversários */}
        <div>
          <SectionLabel text="Aniversários do Mês"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { nome:'Marcos Oliveira', data:'05/06', dept:'TI' },
              { nome:'Patrícia Souza', data:'14/06', dept:'RH' },
              { nome:'João Ferreira', data:'22/06', dept:'Logística' },
            ].map((a,i,arr) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', borderBottom: i<arr.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, color:Z.text, fontFamily:Z.font, fontWeight:500 }}>{a.nome}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>{a.dept}</div>
                </div>
                <ZBadge label={`🎂 ${a.data}`} color={Z.purple} bg={Z.purpleDim}/>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── PCP ───────────────────────────────────────────────────────
function PCPScreen({ onBack }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="PCP" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <KPICard title="OP em andamento" value="15" color={Z.yellow} spark={[10,12,11,14,13,15,14,16,15,15]}/>
          <KPICard title="Eficiência" value="87%" change="+3%" up={true} color={Z.green} spark={[80,82,81,84,83,85,84,86,85,87]}/>
        </div>
        <div>
          <SectionLabel text="Ordens de Produção"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { op:'OP-2401', prod:'Perfil 45x90', qtd:'500 kg', prog:75, status:'Em produção', sc:Z.yellow, sd:Z.yellowDim },
              { op:'OP-2402', prod:'Tubo Ret. 40x20', qtd:'300 kg', prog:40, status:'Em produção', sc:Z.yellow, sd:Z.yellowDim },
              { op:'OP-2403', prod:'Chapa 3mm', qtd:'1.200 kg', prog:100, status:'Concluída', sc:Z.green, sd:Z.greenDim },
              { op:'OP-2404', prod:'Barra Chata 3/16', qtd:'800 kg', prog:10, status:'Iniciando', sc:Z.accent, sd:Z.accentDim },
              { op:'OP-2405', prod:'Cantoneira 1.1/4', qtd:'450 kg', prog:0, status:'Aguardando', sc:Z.muted, sd:Z.surface },
            ].map((o,i,a) => (
              <div key={i} style={{ padding:'11px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <div>
                    <span style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{o.op}</span>
                    <span style={{ fontSize:12, color:Z.muted, fontFamily:Z.font }}> — {o.prod}</span>
                  </div>
                  <StatusPill label={o.status} color={o.sc} bg={o.sd}/>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ flex:1, height:5, background:Z.surface, borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${o.prog}%`, height:'100%', background:o.sc, borderRadius:4 }}/>
                  </div>
                  <span style={{ fontSize:11, fontWeight:600, color:o.sc, fontFamily:Z.font, width:30, textAlign:'right' }}>{o.prog}%</span>
                </div>
                <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:3 }}>{o.qtd}</div>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── Logística ──────────────────────────────────────────────────
function LogisticaScreen({ onBack }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Logística" onBack={onBack} right={<IcFilter s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[{ l:'Entregas', v:'22', c:Z.teal },{ l:'Em rota', v:'14', c:Z.yellow },{ l:'Concluídas', v:'8', c:Z.green }].map((k,i)=>(
            <ZCard key={i} style={{ padding:'12px 10px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:Z.muted, fontFamily:Z.font, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>{k.l}</div>
              <div style={{ fontSize:22, fontWeight:700, color:k.c, fontFamily:Z.font }}>{k.v}</div>
            </ZCard>
          ))}
        </div>
        {/* Mapa placeholder */}
        <ZCard style={{ height:120, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:6, background:Z.card }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke={Z.teal} strokeWidth="1.7"/><circle cx="12" cy="9" r="2.5" stroke={Z.teal} strokeWidth="1.5"/></svg>
          <span style={{ fontSize:12, color:Z.muted, fontFamily:Z.font }}>Mapa de Rotas</span>
        </ZCard>
        <div>
          <SectionLabel text="Entregas do Dia"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { id:'ENT-892', dest:'São Paulo — SP', transp:'LogFast', status:'Concluída', sc:Z.green, sd:Z.greenDim },
              { id:'ENT-893', dest:'Campinas — SP', transp:'RapidLog', status:'Em rota', sc:Z.yellow, sd:Z.yellowDim },
              { id:'ENT-894', dest:'Santos — SP', transp:'TransSul', status:'Em rota', sc:Z.yellow, sd:Z.yellowDim },
              { id:'ENT-895', dest:'Ribeirão Preto', transp:'LogFast', status:'Aguardando', sc:Z.muted, sd:Z.surface },
            ].map((e,i,a)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{e.id}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:1 }}>{e.dest} · {e.transp}</div>
                </div>
                <StatusPill label={e.status} color={e.sc} bg={e.sd}/>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── Faturamento ───────────────────────────────────────────────
function FaturamentoScreen({ onBack }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Faturamento" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <KPICard title="NF-e hoje" value="34" change="+6 vs ontem" up={true} color={Z.red} spark={[22,28,25,30,27,32,29,34,31,34]}/>
          <KPICard title="Total faturado" value="R$ 487K" change="+9%" up={true} color={Z.orange} spark={[350,380,365,410,390,440,420,460,445,487]}/>
        </div>
        <div>
          <SectionLabel text="NF-e Emitidas Hoje"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { nf:'NF-001204', dest:'Alpha Ltda', valor:'R$ 28.540', status:'Autorizada', sc:Z.green, sd:Z.greenDim },
              { nf:'NF-001205', dest:'Beta S.A.', valor:'R$ 12.000', status:'Autorizada', sc:Z.green, sd:Z.greenDim },
              { nf:'NF-001206', dest:'Gama Corp', valor:'R$ 45.800', status:'Em processamento', sc:Z.yellow, sd:Z.yellowDim },
              { nf:'NF-001207', dest:'Delta Eireli', valor:'R$ 9.200', status:'Rejeitada', sc:Z.red, sd:Z.redDim },
              { nf:'NF-001208', dest:'Épsilon Ind.', valor:'R$ 31.400', status:'Autorizada', sc:Z.green, sd:Z.greenDim },
            ].map((n,i,a)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{n.nf}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:1 }}>{n.dest}</div>
                </div>
                <div style={{ textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{n.valor}</span>
                  <StatusPill label={n.status} color={n.sc} bg={n.sd}/>
                </div>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── Compras ───────────────────────────────────────────────────
function ComprasScreen({ onBack }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <ScreenHeader title="Compras" onBack={onBack} right={<IcPlus s={18} c={Z.accent}/>}/>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[{ l:'PC Abertos', v:'8', c:Z.orange },{ l:'Aprovados', v:'24', c:Z.green },{ l:'Aguardando', v:'5', c:Z.yellow }].map((k,i)=>(
            <ZCard key={i} style={{ padding:'12px 10px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:Z.muted, fontFamily:Z.font, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>{k.l}</div>
              <div style={{ fontSize:20, fontWeight:700, color:k.c, fontFamily:Z.font }}>{k.v}</div>
            </ZCard>
          ))}
        </div>
        <div>
          <SectionLabel text="Pedidos de Compra"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { pc:'PC-0431', forn:'AluBras Ltda', valor:'R$ 42.000', status:'Aprovação', sc:Z.yellow, sd:Z.yellowDim },
              { pc:'PC-0430', forn:'MetalPrime', valor:'R$ 18.500', status:'Aprovado', sc:Z.green, sd:Z.greenDim },
              { pc:'PC-0429', forn:'Insumos Sul', valor:'R$ 7.800', status:'Recebido', sc:Z.teal, sd:Z.tealDim },
              { pc:'PC-0428', forn:'ForjaMax', valor:'R$ 63.200', status:'Aprovado', sc:Z.green, sd:Z.greenDim },
              { pc:'PC-0427', forn:'AluBras Ltda', valor:'R$ 29.400', status:'Cancelado', sc:Z.red, sd:Z.redDim },
            ].map((p,i,a)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{p.pc}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:1 }}>{p.forn}</div>
                </div>
                <div style={{ textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{p.valor}</span>
                  <StatusPill label={p.status} color={p.sc} bg={p.sd}/>
                </div>
              </div>
            ))}
          </ZCard>
        </div>
        {/* Fornecedores */}
        <div>
          <SectionLabel text="Principais Fornecedores"/>
          <ZCard style={{ overflow:'hidden', padding:0 }}>
            {[
              { nome:'AluBras Ltda', cat:'Alumínio', vol:'R$ 280K' },
              { nome:'MetalPrime', cat:'Inox / Aço', vol:'R$ 195K' },
              { nome:'ForjaMax', cat:'Peças forjadas', vol:'R$ 142K' },
            ].map((f,i,a)=>(
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 14px', borderBottom: i<a.length-1 ? `1px solid ${Z.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:Z.text, fontFamily:Z.font }}>{f.nome}</div>
                  <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font }}>{f.cat}</div>
                </div>
                <span style={{ fontSize:13, fontWeight:600, color:Z.orange, fontFamily:Z.font }}>{f.vol}</span>
              </div>
            ))}
          </ZCard>
        </div>
      </div>
    </div>
  );
}

// ── Módulos Grid ──────────────────────────────────────────────
function ModulosScreen({ onModuleOpen }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:Z.bg, overflow:'hidden' }}>
      <div style={{ padding:'14px 18px 10px', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:700, color:Z.text, fontFamily:Z.font, letterSpacing:-0.3 }}>Módulos</div>
        <div style={{ fontSize:13, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>Plataforma ERP Zyntra</div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 14px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {MODULES.map(m => (
            <button key={m.id} onClick={() => onModuleOpen(m.id)} style={{
              background:Z.card, border:`1px solid ${Z.border}`, borderRadius:18,
              padding:'20px 16px', cursor:'pointer', textAlign:'left',
              display:'flex', flexDirection:'column', gap:10,
              transition:'all 0.2s',
            }}>
              <div style={{ width:44, height:44, borderRadius:13, background:m.dim, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <ModIcon id={m.id} s={22} c={m.color}/>
              </div>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:Z.text, fontFamily:Z.font }}>{m.label}</div>
                <div style={{ fontSize:11, color:Z.muted, fontFamily:Z.font, marginTop:2 }}>
                  {{financeiro:'Contas, DRE, Fluxo',vendas:'Pedidos, Funil, Metas',rh:'Colaboradores, Ponto',pcp:'Ordens de Produção',logistica:'Entregas, Rotas',faturamento:'NF-e, Faturas',compras:'PC, Fornecedores'}[m.id]}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  FinanceiroScreen, VendasScreen, RHScreen, PCPScreen,
  LogisticaScreen, FaturamentoScreen, ComprasScreen, ModulosScreen,
});
