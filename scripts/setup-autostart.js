const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname.replace('scripts', '');
const STARTUP_FOLDER = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS_FILE = path.join(STARTUP_FOLDER, 'ALUFORCE-AutoStart.vbs');

// Conteúdo do script VBS
const vbsContent = `' ALUFORCE Auto-Start Script
' Inicia o servidor silenciosamente ao ligar o Windows
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${SCRIPT_DIR.replace(/\\/g, '\\\\')}"
' Aguarda 15 segundos para garantir que a rede esteja pronta
WScript.Sleep 15000
WshShell.Run "cmd /c cd /d ""${SCRIPT_DIR}"" && node server.js > logs\\autostart.log 2>&1", 0, False
`;

console.log('=== INSTALAÇÁO DO AUTO-START ALUFORCE ===\n');

// Criar pasta logs se não existir
const logsDir = path.join(SCRIPT_DIR, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('✅ Pasta logs/ criada');
}

// Criar arquivo VBS na pasta Startup
try {
    fs.writeFileSync(VBS_FILE, vbsContent, 'utf-8');
    console.log('✅ Script de auto-start criado em:');
    console.log(`   ${VBS_FILE}\n`);
    
    console.log('✅ O servidor ALUFORCE irá iniciar automaticamente');
    console.log('   quando o Windows iniciar.\n');
    
    console.log('📍 Para testar, reinicie o computador ou execute:');
    console.log(`   wscript "${VBS_FILE}"`);
    
} catch (error) {
    console.error('❌ Erro ao criar script:', error.message);
    console.log('\n💡 Tente executar como Administrador');
}

// Mostrar IP da rede
const { networkInterfaces } = require('os');
const nets = networkInterfaces();
console.log('\n🌐 Endereços IP disponíveis:');
for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
            console.log(`   http://${net.address}:3000`);
        }
    }
}
