// zyntra-login.jsx — Login screen

function LoginScreen({ onLogin }) {
  const [tab, setTab] = React.useState('email');
  const [field, setField] = React.useState('');
  const [senha, setSenha] = React.useState('');
  const [showPass, setShowPass] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const handle = () => {
    setLoading(true);
    setTimeout(() => { setSuccess(true); setTimeout(onLogin, 600); }, 1200);
  };

  const inp = {
    width: '100%', background: Z.surface, border: `1px solid ${Z.border}`,
    borderRadius: 13, padding: '14px 16px', fontSize: 15, color: Z.text,
    fontFamily: Z.font, outline: 'none', boxSizing: 'border-box', WebkitAppearance: 'none',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: Z.bg, overflow: 'hidden', position: 'relative' }}>
      {/* ambient glow */}
      <div style={{ position: 'absolute', top: -100, left: '50%', transform: 'translateX(-50%)', width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.13) 0%, transparent 70%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', bottom: -60, right: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)', pointerEvents: 'none' }}/>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', gap: 0 }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: Z.card, border: `1px solid ${Z.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(59,130,246,0.18)', overflow: 'hidden' }}>
            <img src="uploads/logo-1777551715119.png" style={{ width: 52, height: 52, objectFit: 'contain', filter: 'invert(1) brightness(2)' }} alt="Zyntra"/>
          </div>
          <div style={{ marginTop: 14, fontSize: 28, fontWeight: 700, color: Z.text, fontFamily: Z.font, letterSpacing: -0.5 }}>Zyntra</div>
          <div style={{ fontSize: 13, color: Z.muted, fontFamily: Z.font, marginTop: 2 }}>Plataforma ERP Completa</div>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', background: Z.surface, borderRadius: 11, padding: 3, marginBottom: 16, border: `1px solid ${Z.border}` }}>
          {['email','cpf'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: tab === t ? Z.accent : 'transparent',
              color: tab === t ? '#fff' : Z.muted,
              fontSize: 13, fontWeight: 700, fontFamily: Z.font, letterSpacing: 0.3,
              transition: 'all 0.2s',
            }}>{t.toUpperCase()}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 8 }}>
          <input style={inp} placeholder={tab === 'email' ? 'E-mail corporativo' : 'CPF (000.000.000-00)'} value={field} onChange={e => setField(e.target.value)} type={tab === 'email' ? 'email' : 'text'}/>
          <div style={{ position: 'relative' }}>
            <input style={{ ...inp, paddingRight: 48 }} placeholder="Senha" type={showPass ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)}/>
            <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" stroke={Z.muted} strokeWidth="1.7"/><circle cx="12" cy="12" r="3" stroke={showPass ? Z.accent : Z.muted} strokeWidth="1.7"/></svg>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${Z.border}`, background: Z.surface }}/>
            <span style={{ fontSize: 12, color: Z.muted, fontFamily: Z.font }}>Lembrar por 30 dias</span>
          </label>
          <button style={{ background: 'none', border: 'none', color: Z.accent, fontSize: 13, fontFamily: Z.font, cursor: 'pointer', fontWeight: 500 }}>Esqueceu a senha?</button>
        </div>

        <button onClick={handle} disabled={loading} style={{
          width: '100%', padding: '15px 0', borderRadius: 14, border: 'none', cursor: loading ? 'default' : 'pointer',
          background: success ? Z.green : loading ? `linear-gradient(135deg, #2563EB, #1D4ED8)` : `linear-gradient(135deg, #3B82F6, #2563EB)`,
          color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: Z.font,
          boxShadow: loading ? 'none' : '0 6px 24px rgba(59,130,246,0.3)',
          transition: 'all 0.3s', letterSpacing: 0.2,
        }}>
          {success ? '✓ Login realizado!' : loading ? 'Entrando...' : 'Entrar'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: Z.border }}/>
          <span style={{ fontSize: 12, color: Z.muted, fontFamily: Z.font }}>ou acesse com</span>
          <div style={{ flex: 1, height: 1, background: Z.border }}/>
        </div>

        <button style={{ padding: '13px 0', borderRadius: 14, border: `1px solid ${Z.border}`, background: Z.surface, color: Z.textSoft, fontSize: 14, fontWeight: 500, fontFamily: Z.font, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="8" height="10" rx="1.5" stroke={Z.mutedLight} strokeWidth="1.7"/><rect x="3" y="5" width="8" height="5" rx="1.5" stroke={Z.mutedLight} strokeWidth="1.7"/><rect x="13" y="5" width="8" height="16" rx="1.5" stroke={Z.mutedLight} strokeWidth="1.7"/></svg>
          Face ID / Touch ID
        </button>
      </div>

      <div style={{ padding: '14px 28px', textAlign: 'center', fontSize: 11, color: Z.muted, fontFamily: Z.font, flexShrink: 0 }}>
        © 2026 Zyntra — Desenvolvido por Agência do Japa
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
