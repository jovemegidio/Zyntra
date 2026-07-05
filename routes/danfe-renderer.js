'use strict';
/**
 * DANFE Renderer — template Mustache-like para impressão de Nota Fiscal
 * Carrega o layout oficial de disk: Templates - Sistema/Espelho Danfe/danfe.html
 */

const fs   = require('fs');
const path = require('path');

// ─── Template HTML ────────────────────────────────────────────────────────────
// Loaded from the canonical design file; any edit to danfe.html takes effect
// after server restart without changing this file.
let DANFE_TEMPLATE;
try {
    DANFE_TEMPLATE = fs.readFileSync(
        path.resolve(__dirname, 'danfe.html'),
        'utf8'
    );
} catch (e) {
    console.error('[DANFE] Template não encontrado em disk — verifique o deploy de routes/danfe.html:', e.message);
    DANFE_TEMPLATE = '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px"><h2>Erro: template DANFE não encontrado</h2><p>Faça o deploy de <code>routes/danfe.html</code> no servidor e reinicie o PM2.</p></body></html>';
}

// ─── EMBEDDED FALLBACK (kept for reference; NOT used at runtime) ──────────────
const _DANFE_TEMPLATE_EMBEDDED_FALLBACK = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DANFE - Documento Auxiliar da Nota Fiscal Eletrônica</title>
  <style>
    :root{
      --ink:#111;
      --line:#1b1b1b;
      --paper:#fff;
      --bg:#e9e9e9;
      --thin:0.22mm solid var(--line);
    }
    *{box-sizing:border-box;}
    html,body{margin:0;padding:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink);}
    body{padding:14px;}
    .page{
      width:210mm;
      min-height:297mm;
      margin:0 auto;
      background:var(--paper);
      box-shadow:0 8px 32px rgba(0,0,0,.12);
      padding:4.8mm 5mm 5.8mm;
      position:relative;
      overflow:hidden;
    }
    .no-print{text-align:center;margin:12px 0;font-family:sans-serif;}
    .watermark{
      position:absolute;
      inset:0;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:38pt;
      font-weight:700;
      letter-spacing:1.2px;
      color:rgba(0,0,0,.09);
      transform:rotate(-50deg);
      pointer-events:none;
      user-select:none;
      text-align:center;
      line-height:1;
      padding:0 10mm;
    }
    .watermark.hidden{display:none;}
    .top-note{
      font-size:6pt;
      line-height:1.2;
      min-height:3.5mm;
      margin:0 0 2.3mm;
      color:#444;
    }
    .doc-title{
      text-align:center;
      font-size:10pt;
      font-weight:700;
      margin:0 0 2mm;
      text-transform:uppercase;
      letter-spacing:.15px;
    }
    .box{border:var(--thin); margin-bottom:1.35mm; background:#fff;}
    .section-label{
      border-bottom:var(--thin);
      font-size:6.8pt;
      font-weight:700;
      text-transform:uppercase;
      padding:0.7mm 1.1mm;
      line-height:1;
      background:#fafafa;
      letter-spacing:.12px;
    }
    .row{display:grid; width:100%;}
    .row > .cell:last-child{border-right:none;}
    .cell{
      min-height:7.2mm;
      border-right:var(--thin);
      border-bottom:var(--thin);
      padding:0.72mm 1.05mm 0.68mm;
      overflow:hidden;
    }
    .row:last-child .cell{border-bottom:none;}
    .label{
      display:block;
      font-size:4.9pt;
      text-transform:uppercase;
      line-height:1.05;
      margin-bottom:0.55mm;
      color:#222;
    }
    .value{
      display:block;
      font-size:6.1pt;
      line-height:1.18;
      word-break:break-word;
      overflow-wrap:anywhere;
    }
    .value.lg{font-size:7pt;}
    .value.strong{font-weight:700;}
    .center{text-align:center;}
    .right{text-align:right;}
    .header-main{
      display:grid;
      grid-template-columns:36% 16% 48%;
      border-bottom:var(--thin);
    }
    .header-main > div{min-height:33mm;}
    .issuer{
      border-right:var(--thin);
      display:flex;
      flex-direction:column;
      min-width:0;
    }
    .logo-band{
      min-height:13.5mm;
      border-bottom:var(--thin);
      display:flex;
      align-items:center;
      gap:2.4mm;
      padding:1.2mm 2mm;
      background:#fff;
      overflow:hidden;
    }
    .logo-band img.logo-img{
      display:block;
      max-width:28mm;
      max-height:9mm;
      object-fit:contain;
      flex:0 0 auto;
    }
    .logo-fallback{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:14mm;
      height:8.5mm;
      padding:0 2mm;
      border:var(--thin);
      font-size:7pt;
      font-weight:700;
      flex:0 0 auto;
      background:#fff;
    }
    .brand-name{flex:1 1 auto; min-width:0;}
    .issuer-body{
      padding:1.15mm 2mm 1.25mm;
      font-size:5.8pt;
      line-height:1.28;
      white-space:pre-line;
      flex:1;
      overflow-wrap:anywhere;
    }
    .danfe-core{
      border-right:var(--thin);
      padding:1.15mm 1.5mm;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      min-width:0;
    }
    .danfe-title{
      text-align:center;
      font-weight:700;
      font-size:9.3pt;
      line-height:1;
      margin-bottom:0.65mm;
    }
    .danfe-sub{
      text-align:center;
      font-size:5.1pt;
      line-height:1.12;
      margin-bottom:1.1mm;
    }
    .entry-exit{
      display:grid;
      grid-template-columns:1fr 8.5mm;
      gap:1mm;
      align-items:end;
      margin-bottom:0.9mm;
    }
    .entry-exit .mini-block{
      font-size:5.7pt;
      line-height:1.25;
    }
    .entry-exit .indicator{
      width:8.5mm;
      height:8.5mm;
      border:var(--thin);
      font-size:7.3pt;
      font-weight:700;
      display:flex;
      align-items:center;
      justify-content:center;
      flex:0 0 auto;
    }
    .number-block{
      font-size:5.7pt;
      line-height:1.28;
      margin-top:0.6mm;
    }
    .number-block .nfe-no{
      font-size:7pt;
      font-weight:700;
      line-height:1.14;
    }
    .pages{
      margin-top:1.4mm;
      font-size:5.4pt;
      text-align:right;
    }
    .access{
      padding:1.15mm 1.5mm;
      display:flex;
      flex-direction:column;
      gap:0.85mm;
      min-width:0;
    }
    .consult-note{
      font-size:5pt;
      line-height:1.18;
      text-align:center;
      min-height:6.5mm;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:0 0.6mm;
      overflow-wrap:anywhere;
    }
    .barcode-box{
      border:var(--thin);
      min-height:12.5mm;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:0.8mm;
      background:#fff;
      overflow:hidden;
    }
    .barcode-box img.barcode-img{
      display:block;
      width:100%;
      max-height:10mm;
      object-fit:contain;
    }
    .barcode-fallback{
      display:block;
      width:100%;
      font-size:6pt;
      font-weight:700;
      letter-spacing:.25px;
      font-family:"Courier New", monospace;
      text-align:center;
      line-height:1.15;
      overflow-wrap:anywhere;
    }
    .key-box{
      border:var(--thin);
      padding:0.8mm 1mm;
      text-align:center;
      min-height:8.3mm;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:6.15pt;
      font-weight:700;
      letter-spacing:.18px;
      line-height:1.14;
      font-family:"Courier New", monospace;
      overflow-wrap:anywhere;
      word-break:break-word;
    }
    .auth-box{
      border:var(--thin);
      min-height:8.8mm;
      padding:0.75mm 0.95mm;
      display:flex;
      flex-direction:column;
      justify-content:center;
      text-align:center;
      font-size:5.05pt;
      line-height:1.14;
      overflow-wrap:anywhere;
    }
    table{
      width:100%;
      border-collapse:collapse;
      table-layout:fixed;
    }
    th, td{
      border-right:var(--thin);
      border-bottom:var(--thin);
      padding:0.8mm 0.95mm;
      font-size:5.85pt;
      line-height:1.18;
      vertical-align:top;
      word-break:break-word;
      overflow-wrap:anywhere;
    }
    th:last-child, td:last-child{border-right:none;}
    thead th{
      font-size:4.95pt;
      text-transform:uppercase;
      font-weight:400;
      background:#fafafa;
      text-align:left;
    }
    tbody tr:last-child td{border-bottom:none;}
    .products tbody td{min-height:6.5mm;}
    .totals-note{
      font-size:5.45pt;
      line-height:1.2;
      padding-top:0.75mm;
      white-space:pre-line;
      overflow-wrap:anywhere;
    }
    .additional{
      display:grid;
      grid-template-columns:1fr 38%;
      min-height:40mm;
    }
    .additional > div:first-child{border-right:var(--thin);}
    .fill-box{
      padding:1.05mm 1.25mm;
      font-size:5.85pt;
      line-height:1.28;
      white-space:pre-line;
      overflow-wrap:anywhere;
    }
    .footer-note{
      margin-top:0.9mm;
      font-size:5pt;
      color:#333;
      text-align:right;
    }
    @media print{
      .no-print{display:none;}
      html,body{background:#fff; padding:0;}
      .page{
        margin:0;
        box-shadow:none;
        width:210mm;
        min-height:297mm;
        padding:4.8mm 5mm 5.8mm;
      }
      @page{size:A4 portrait; margin:0;}
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:10px 28px;font-size:14px;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:600;">&#128424; Imprimir DANFE</button>
  </div>
  <div class="page">
    <div class="watermark {{marcaAguaClasse}}">{{marcaAguaTexto}}</div>

    <p class="top-note">{{avisoTopo}}</p>
    <h1 class="doc-title">DANFE - Documento Auxiliar da Nota Fiscal Eletr&#244;nica</h1>

    <section class="box">
      <div class="header-main">
        <div class="issuer">
          <div class="logo-band">
            <img class="logo-img" src="{{emitenteLogoUrl}}" alt="Logo do emitente" onerror="this.style.display='none'" />
            <span class="logo-fallback">{{NFe.infNFe.emit.xFant}}</span>
            <span class="value strong lg brand-name">{{NFe.infNFe.emit.xFant}}</span>
          </div>
          <div class="issuer-body">{{NFe.infNFe.emit.xNome}}
{{NFe.infNFe.emit.enderEmit.xLgr}}, {{NFe.infNFe.emit.enderEmit.nro}} {{NFe.infNFe.emit.enderEmit.xCpl}}
{{NFe.infNFe.emit.enderEmit.xBairro}} - {{NFe.infNFe.emit.enderEmit.xMun}} - {{NFe.infNFe.emit.enderEmit.UF}} - CEP {{NFe.infNFe.emit.enderEmit.CEP}}
{{NFe.infNFe.emit.enderEmit.fone}}
{{NFe.infNFe.emit.email}}</div>
        </div>

        <div class="danfe-core">
          <div>
            <div class="danfe-title">DANFE</div>
            <div class="danfe-sub">Documento Auxiliar da<br>Nota Fiscal Eletr&#244;nica</div>
          </div>

          <div class="entry-exit">
            <div class="mini-block">
              <div>0 - Entrada</div>
              <div>1 - Sa&#237;da</div>
            </div>
            <div class="indicator">{{NFe.infNFe.ide.tpNF}}</div>
          </div>

          <div class="number-block">
            <div class="nfe-no">N&#186; {{NFe.infNFe.ide.nNF}}</div>
            <div>S&#233;rie {{NFe.infNFe.ide.serie}}</div>
          </div>

          <div class="pages">Folha {{paginaAtual}}/{{paginaTotal}}</div>
        </div>

        <div class="access">
          <div class="consult-note">
            Consulta de autenticidade no portal nacional da NF-e<br>
            {{portalConsultaUrl}}<br>
            ou no site da Sefaz autorizadora
          </div>

          <div class="barcode-box">
            <img class="barcode-img" src="{{codigoBarrasUrl}}" alt="C&#243;digo de barras da chave de acesso" onerror="this.style.display='none'">
            <span class="barcode-fallback">{{protNFe.infProt.chNFe}}</span>
          </div>

          <div class="key-box">{{protNFe.infProt.chNFe}}</div>

          <div class="auth-box">
            <div class="value strong">Protocolo de Autoriza&#231;&#227;o de Uso</div>
            <div>{{protNFe.infProt.nProt}}</div>
            <div>{{protNFe.infProt.dhRecbto}}</div>
          </div>
        </div>
      </div>

      <div class="row" style="grid-template-columns: 56% 22% 22%;">
        <div class="cell">
          <span class="label">Natureza da opera&#231;&#227;o</span>
          <span class="value">{{NFe.infNFe.ide.natOp}}</span>
        </div>
        <div class="cell">
          <span class="label">Inscri&#231;&#227;o Estadual</span>
          <span class="value">{{NFe.infNFe.emit.IE}}</span>
        </div>
        <div class="cell">
          <span class="label">CNPJ / CPF</span>
          <span class="value">{{NFe.infNFe.emit.CNPJ}}{{NFe.infNFe.emit.CPF}}</span>
        </div>
      </div>

      <div class="row" style="grid-template-columns: 56% 44%;">
        <div class="cell">
          <span class="label">Inscri&#231;&#227;o Estadual do Subst. Tribut&#225;rio</span>
          <span class="value">{{NFe.infNFe.emit.IEST}}</span>
        </div>
        <div class="cell">
          <span class="label">C&#243;digo de Regime Tribut&#225;rio</span>
          <span class="value">{{NFe.infNFe.emit.CRT}}</span>
        </div>
      </div>
    </section>

    <section class="box">
      <div class="section-label">Destinat&#225;rio / Remetente</div>

      <div class="row" style="grid-template-columns: 58% 18% 12% 12%;">
        <div class="cell">
          <span class="label">Nome / Raz&#227;o Social</span>
          <span class="value">{{NFe.infNFe.dest.xNome}}</span>
        </div>
        <div class="cell">
          <span class="label">CNPJ / CPF</span>
          <span class="value">{{NFe.infNFe.dest.CNPJ}}{{NFe.infNFe.dest.CPF}}</span>
        </div>
        <div class="cell">
          <span class="label">Data da emiss&#227;o</span>
          <span class="value">{{NFe.infNFe.ide.dhEmi}}</span>
        </div>
        <div class="cell">
          <span class="label">Data da sa&#237;da / entrada</span>
          <span class="value">{{NFe.infNFe.ide.dhSaiEnt}}</span>
        </div>
      </div>

      <div class="row" style="grid-template-columns: 46% 18% 16% 8% 12%;">
        <div class="cell">
          <span class="label">Endere&#231;o</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.xLgr}}, {{NFe.infNFe.dest.enderDest.nro}} {{NFe.infNFe.dest.enderDest.xCpl}}</span>
        </div>
        <div class="cell">
          <span class="label">Bairro / Distrito</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.xBairro}}</span>
        </div>
        <div class="cell">
          <span class="label">CEP</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.CEP}}</span>
        </div>
        <div class="cell">
          <span class="label">UF</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.UF}}</span>
        </div>
        <div class="cell">
          <span class="label">Hora da sa&#237;da</span>
          <span class="value">{{NFe.infNFe.ide._danfeHoraSaida}}</span>
        </div>
      </div>

      <div class="row" style="grid-template-columns: 34% 18% 18% 12% 18%;">
        <div class="cell">
          <span class="label">Munic&#237;pio</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.xMun}}</span>
        </div>
        <div class="cell">
          <span class="label">Fone / Fax</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.fone}}</span>
        </div>
        <div class="cell">
          <span class="label">Inscri&#231;&#227;o Estadual</span>
          <span class="value">{{NFe.infNFe.dest.IE}}</span>
        </div>
        <div class="cell">
          <span class="label">UF</span>
          <span class="value">{{NFe.infNFe.dest.enderDest.UF}}</span>
        </div>
        <div class="cell">
          <span class="label">Indicador IE</span>
          <span class="value">{{NFe.infNFe.dest.indIEDest}}</span>
        </div>
      </div>
    </section>

    <section class="box">
      <div class="section-label">Fatura / Duplicatas</div>
      <table>
        <thead>
          <tr>
            <th style="width:34%;">N&#250;mero</th>
            <th style="width:33%;">Vencimento</th>
            <th style="width:33%;">Valor</th>
          </tr>
        </thead>
        <tbody>
          {{#NFe.infNFe.cobr.dup}}
          <tr>
            <td>{{nDup}}</td>
            <td>{{dVenc}}</td>
            <td class="right">{{vDup}}</td>
          </tr>
          {{/NFe.infNFe.cobr.dup}}
          {{^NFe.infNFe.cobr.dup}}
          <tr>
            <td>{{NFe.infNFe.cobr.fat.nFat}}</td>
            <td>{{NFe.infNFe.cobr.fat.vOrig}}</td>
            <td class="right">{{NFe.infNFe.cobr.fat.vLiq}}</td>
          </tr>
          {{/NFe.infNFe.cobr.dup}}
        </tbody>
      </table>
    </section>

    <section class="box">
      <div class="section-label">C&#225;lculo do imposto</div>
      <div class="row" style="grid-template-columns: 14% 14% 14% 14% 14% 15% 15%;">
        <div class="cell"><span class="label">Base de c&#225;lculo do ICMS</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vBC}}</span></div>
        <div class="cell"><span class="label">Valor do ICMS</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vICMS}}</span></div>
        <div class="cell"><span class="label">Base de c&#225;lculo ICMS ST</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vBCST}}</span></div>
        <div class="cell"><span class="label">Valor do ICMS ST</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vST}}</span></div>
        <div class="cell"><span class="label">Valor aprox. tributos</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vTotTrib}}</span></div>
        <div class="cell"><span class="label">Valor total dos produtos</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vProd}}</span></div>
        <div class="cell"><span class="label">Valor do FCP ST retido</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vFCPSTRet}}</span></div>
      </div>
      <div class="row" style="grid-template-columns: 14% 14% 14% 14% 14% 15% 15%;">
        <div class="cell"><span class="label">Valor do frete</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vFrete}}</span></div>
        <div class="cell"><span class="label">Valor do seguro</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vSeg}}</span></div>
        <div class="cell"><span class="label">Desconto</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vDesc}}</span></div>
        <div class="cell"><span class="label">Outras despesas acess&#243;rias</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vOutro}}</span></div>
        <div class="cell"><span class="label">Valor do IPI</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vIPI}}</span></div>
        <div class="cell"><span class="label">Valor total da nota</span><span class="value right strong">{{NFe.infNFe.total.ICMSTot.vNF}}</span></div>
        <div class="cell"><span class="label">Valor total do II</span><span class="value right">{{NFe.infNFe.total.ICMSTot.vII}}</span></div>
      </div>
    </section>

    <section class="box">
      <div class="section-label">Transportador / Volumes transportados</div>

      <div class="row" style="grid-template-columns: 38% 12% 18% 10% 10% 12%;">
        <div class="cell"><span class="label">Raz&#227;o Social</span><span class="value">{{NFe.infNFe.transp.transporta.xNome}}</span></div>
        <div class="cell"><span class="label">Frete por conta</span><span class="value">{{NFe.infNFe.transp.modFrete}}</span></div>
        <div class="cell"><span class="label">C&#243;digo ANTT</span><span class="value">{{NFe.infNFe.transp.veicTransp.RNTC}}</span></div>
        <div class="cell"><span class="label">Placa do ve&#237;culo</span><span class="value">{{NFe.infNFe.transp.veicTransp.placa}}</span></div>
        <div class="cell"><span class="label">UF</span><span class="value">{{NFe.infNFe.transp.veicTransp.UF}}</span></div>
        <div class="cell"><span class="label">CNPJ / CPF</span><span class="value">{{NFe.infNFe.transp.transporta.CNPJ}}{{NFe.infNFe.transp.transporta.CPF}}</span></div>
      </div>

      <div class="row" style="grid-template-columns: 46% 12% 12% 12% 18%;">
        <div class="cell"><span class="label">Endere&#231;o</span><span class="value">{{NFe.infNFe.transp.transporta.xEnder}}</span></div>
        <div class="cell"><span class="label">Munic&#237;pio</span><span class="value">{{NFe.infNFe.transp.transporta.xMun}}</span></div>
        <div class="cell"><span class="label">UF</span><span class="value">{{NFe.infNFe.transp.transporta.UF}}</span></div>
        <div class="cell"><span class="label">Inscri&#231;&#227;o Estadual</span><span class="value">{{NFe.infNFe.transp.transporta.IE}}</span></div>
        <div class="cell"><span class="label">Quantidade</span><span class="value">{{NFe.infNFe.transp._danfeQVol}}</span></div>
      </div>

      <div class="row" style="grid-template-columns: 24% 24% 18% 16% 18%;">
        <div class="cell"><span class="label">Esp&#233;cie</span><span class="value">{{NFe.infNFe.transp._danfeEsp}}</span></div>
        <div class="cell"><span class="label">Marca</span><span class="value">{{NFe.infNFe.transp._danfeMarca}}</span></div>
        <div class="cell"><span class="label">Numera&#231;&#227;o</span><span class="value">{{NFe.infNFe.transp._danfeNVol}}</span></div>
        <div class="cell"><span class="label">Peso bruto</span><span class="value right">{{NFe.infNFe.transp._danfePesoB}}</span></div>
        <div class="cell"><span class="label">Peso l&#237;quido</span><span class="value right">{{NFe.infNFe.transp._danfePesoL}}</span></div>
      </div>
    </section>

    <section class="box">
      <div class="section-label">Dados dos produtos / servi&#231;os</div>
      <table class="products">
        <thead>
          <tr>
            <th style="width:6%;">C&#243;d. produto</th>
            <th style="width:26%;">Descri&#231;&#227;o do produto / servi&#231;o</th>
            <th style="width:6%;">NCM/SH</th>
            <th style="width:4%;">CST</th>
            <th style="width:4%;">CFOP</th>
            <th style="width:4%;">UN</th>
            <th style="width:7%;">Qtde.</th>
            <th style="width:8%;">Vlr. unit.</th>
            <th style="width:8%;">Vlr. total</th>
            <th style="width:7%;">BC ICMS</th>
            <th style="width:6%;">Vlr. ICMS</th>
            <th style="width:6%;">Vlr. IPI</th>
            <th style="width:4%;">Al&#237;q. ICMS</th>
            <th style="width:4%;">Al&#237;q. IPI</th>
          </tr>
        </thead>
        <tbody>
          {{#NFe.infNFe.det}}
          <tr>
            <td>{{prod.cProd}}</td>
            <td>{{prod.xProd}}</td>
            <td>{{prod.NCM}}</td>
            <td class="center">{{_danfeCstCsosn}}</td>
            <td class="center">{{prod.CFOP}}</td>
            <td class="center">{{prod.uCom}}</td>
            <td class="right">{{prod.qCom}}</td>
            <td class="right">{{prod.vUnCom}}</td>
            <td class="right">{{prod.vProd}}</td>
            <td class="right">{{_danfeBcIcms}}</td>
            <td class="right">{{_danfeVIcms}}</td>
            <td class="right">{{_danfeVIpi}}</td>
            <td class="right">{{_danfePIcms}}</td>
            <td class="right">{{_danfePIpi}}</td>
          </tr>
          {{/NFe.infNFe.det}}
        </tbody>
      </table>
      <div class="fill-box totals-note">{{NFe.infNFe.infAdProd}}{{NFe.infNFe.infAdic.infCpl}}</div>
    </section>

    <section class="box">
      <div class="section-label">C&#225;lculo do ISSQN</div>
      <div class="row" style="grid-template-columns: 20% 22% 22% 18% 18%;">
        <div class="cell"><span class="label">Inscri&#231;&#227;o Municipal</span><span class="value">{{NFe.infNFe.emit.IM}}</span></div>
        <div class="cell"><span class="label">Valor total dos servi&#231;os</span><span class="value right">{{NFe.infNFe.total.ISSQNtot.vServ}}</span></div>
        <div class="cell"><span class="label">Base de c&#225;lculo do ISSQN</span><span class="value right">{{NFe.infNFe.total.ISSQNtot.vBC}}</span></div>
        <div class="cell"><span class="label">Valor do ISSQN</span><span class="value right">{{NFe.infNFe.total.ISSQNtot.vISS}}</span></div>
        <div class="cell"><span class="label">Dados adicionais munic&#237;pio</span><span class="value">{{NFe.infNFe.total.ISSQNtot.cMunFG}}</span></div>
      </div>
    </section>

    <section class="box">
      <div class="section-label">Dados adicionais</div>
      <div class="additional">
        <div>
          <div class="label" style="padding:1mm 1.2mm 0;">Informa&#231;&#245;es complementares</div>
          <div class="fill-box">{{NFe.infNFe.infAdic.infCpl}}</div>
        </div>
        <div>
          <div class="label" style="padding:1mm 1.2mm 0;">Reservado ao Fisco</div>
          <div class="fill-box">{{NFe.infNFe.infAdic.infAdFisco}}</div>
        </div>
      </div>
    </section>

    <div class="footer-note">DANFE modelo 55 - campos alinhados ao XML da NF-e + derivados de backend para renderiza&#231;&#227;o</div>
  </div>
</body>
</html>`;

// ─── Template engine ──────────────────────────────────────────────────────────

/**
 * Traverse a dot-notation path in an object.
 * Returns '' for missing paths (never throws).
 */
function getDeep(obj, path) {
    return path.split('.').reduce(
        (o, k) => (o != null && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : '',
        obj
    );
}

/**
 * Render the DANFE template with the supplied context.
 * Supports:
 *   {{path.to.value}}          — simple substitution
 *   {{#path.to.array}} ... {{/path.to.array}}   — loop (each element becomes context)
 *   {{^path.to.array}} ... {{/path.to.array}}   — inverted (shown when array is empty/absent)
 */
function renderDanfe(ctx) {
    let html = DANFE_TEMPLATE;

    // Inject print button (screen-only — hidden via embedded style when printing)
    html = html.replace(
        /<body>/,
        '<body>\n  <div id="_danfe_print_btn"><style>@media print{#_danfe_print_btn{display:none!important}}</style>' +
        '<div style="text-align:center;margin:12px 0;font-family:sans-serif;">' +
        '<button onclick="window.print()" style="padding:10px 28px;font-size:14px;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:600;">&#128424; Imprimir DANFE</button>' +
        '</div></div>'
    );

    // 1. Positive sections — {{#path}}...{{/path}} → iterate array
    html = html.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, path, inner) => {
        const arr = getDeep(ctx, path);
        if (!Array.isArray(arr) || arr.length === 0) return '';
        return arr.map(item =>
            inner.replace(/\{\{([\w.]+)\}\}/g, (__, p) => {
                const v = getDeep(item, p);
                return (v !== '' && v != null) ? String(v) : '';
            })
        ).join('');
    });

    // 2. Inverted sections — {{^path}}...{{/path}} → shown when array empty
    html = html.replace(/\{\{\^([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, path, inner) => {
        const arr = getDeep(ctx, path);
        if (Array.isArray(arr) && arr.length > 0) return '';
        return inner.replace(/\{\{([\w.]+)\}\}/g, (__, p) => {
            const v = getDeep(ctx, p);
            return v != null ? String(v) : '';
        });
    });

    // 3. Simple value substitution
    html = html.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
        const v = getDeep(ctx, path);
        return v != null ? String(v) : '';
    });

    return html;
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Build the NFe-shaped template context from pedido DB data.
 *
 * @param {object} pedido  - row from `pedidos` JOIN `clientes` JOIN `empresas`
 * @param {Array}  itens   - rows from `pedido_itens`
 * @param {object} [opts]  - options: { preview: boolean }
 * @returns {object} template context
 */
function buildDanfeCtx(pedido, itens, opts = {}) {
  const firstFilled = (...vals) => {
    for (const v of vals) {
      if (v === 0) return 0;
      if (v != null && String(v).trim() !== '') return v;
    }
    return '';
  };
  // Alíquotas em pedido_itens têm DEFAULT 0.00 (não NULL) quando nunca foram preenchidas —
  // firstFilled() pararia no primeiro 0 e nunca cairia no padrão fiscal da empresa (ex.: ICMS
  // 18% configurado em config_fiscal_empresa). Para alíquotas, 0 só vale se for o ÚLTIMO
  // candidato (o próprio padrão), nunca um valor intermediário.
  const firstPositiveOrLast = (...vals) => {
    for (let i = 0; i < vals.length; i++) {
      const n = parseFloat(vals[i]);
      if (!isNaN(n) && (n > 0 || i === vals.length - 1)) return n;
    }
    return 0;
  };
    const fmtMoney = v =>
        (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQty = v =>
        (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const fmtDate = d => {
        if (!d) return '';
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR');
    };
    const fmtTime = d => {
        if (!d) return '';
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const nfNumero   = pedido.nf || pedido.numero_nf || (opts.preview ? 'PRÉVIA' : '');
    const valorTotal = parseFloat(pedido.valor_total || pedido.valor) || 0;
    const frete      = parseFloat(pedido.frete) || 0;
    const desconto   = parseFloat(pedido.desconto) || 0;
    const seguro     = parseFloat(pedido.valor_seguro) || 0;
    const outras     = parseFloat(pedido.outras_despesas) || 0;
    const valorBruto = valorTotal + frete + seguro + outras;
    const valorNF    = valorBruto - desconto;
    let chave        = String(pedido.nfe_chave || pedido.chave_acesso || '').replace(/\D/g, '');

    // Configuração fiscal padrão da empresa
    const cfgFiscal = opts.cfgFiscal || {};
    const cfopPadrao = cfgFiscal.cfop_venda_estado || '5102';

    // Em modo preview sem chave real, gerar chave de acesso ilustrativa
    if (chave.length !== 44) {
      chave = '';
    }
    if (!chave && opts.preview) {
        const cnpjClean = (pedido.empresa_cnpj || '').replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
        const uf = '35'; // SP
        const now = new Date();
        const aamm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
        const modelo = '55';
        const serie = String(pedido.serie_nf || '1').padStart(3, '0');
        const nnf = String(pedido.id || 0).padStart(9, '0');
        const tpEmis = '1';
        const codNum = String((pedido.id || 0) % 100000000).padStart(8, '0');
        const base43 = uf + aamm + cnpjClean + modelo + serie + nnf + tpEmis + codNum;
        // DV mod11 simplificado
        let soma = 0, peso = 2;
        for (let i = base43.length - 1; i >= 0; i--) {
            soma += parseInt(base43[i]) * peso;
            peso = peso >= 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        chave = base43 + (dv >= 10 ? '0' : String(dv));
    }

    // Split "Rua Tal, 123" into street + number
    const splitEndereco = str => {
        const m = (str || '').match(/^(.+?),\s*(\S+.*)$/);
        return m ? [m[1].trim(), m[2].trim()] : [(str || ''), ''];
    };
    const [empLgr, empNro] = splitEndereco(pedido.empresa_endereco);
    const [dstLgr, dstNro] = splitEndereco(pedido.cliente_endereco);

    // Generate duplicatas from installment condition string (e.g. "28/35/42/49" or plain count)
    const dups = [];
    const condicaoStr = String(pedido.condicao_pagamento || pedido.parcelas || '');
    // Parse slash-separated days like "28/35/42/49"
    const diasMatch = condicaoStr.match(/\d+/g);
    if (diasMatch && diasMatch.length > 1) {
        // Multiple days = multiple installments with specific due dates
        const valorParcela = valorNF / diasMatch.length;
        const base = new Date(pedido.data_faturamento || pedido.created_at || new Date());
        const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        diasMatch.forEach((dias, i) => {
            const venc = new Date(baseDay);
            venc.setDate(venc.getDate() + parseInt(dias));
            dups.push({
                nDup: String(i + 1).padStart(3, '0'),
                dVenc: venc.toLocaleDateString('pt-BR'),
                vDup: fmtMoney(valorParcela)
            });
        });
    } else {
        const nParcelas = parseInt(condicaoStr) || 0;
        if (nParcelas > 1) {
            const valorParcela = valorNF / nParcelas;
            const base = pedido.data_vencimento ? new Date(pedido.data_vencimento) : new Date();
            for (let i = 0; i < nParcelas; i++) {
                const venc = new Date(base);
                venc.setDate(venc.getDate() + i * 30);
                dups.push({
                    nDup: String(i + 1).padStart(3, '0'),
                    dVenc: venc.toLocaleDateString('pt-BR'),
                    vDup: fmtMoney(valorParcela)
                });
            }
        }
    }

    // Se nenhuma duplicata foi gerada (ex: A Vista), criar fatura única
    if (dups.length === 0) {
      const dataFat = new Date(pedido.data_faturamento || pedido.faturado_em || pedido.created_at || new Date());
        dups.push({
            nDup: nfNumero || '001',
            dVenc: fmtDate(dataFat),
            vDup: fmtMoney(valorNF)
        });
    }
    const vencFat = dups[0]?.dVenc || fmtDate(pedido.data_faturamento || pedido.faturado_em || pedido.created_at);

    const regime = String(cfgFiscal.regime_tributario || '').toLowerCase();
    const simplesNacional = regime === 'simples_nacional';
    const cstPadrao = simplesNacional ? '102' : '00';
    const crtEmitente = String(firstFilled(
      pedido.empresa_crt,
      cfgFiscal.crt,
      regime === 'simples_nacional' ? 1 : 3
    ));
    const aliquotaIcmsPadrao = simplesNacional ? 0 : (parseFloat(cfgFiscal.icms_padrao) || 0);
    const aliquotaIpiPadrao = parseFloat(cfgFiscal.ipi_padrao) || 0;
    const aliquotaPisPadrao = parseFloat(cfgFiscal.pis_padrao) || 0;
    const aliquotaCofinsPadrao = parseFloat(cfgFiscal.cofins_padrao) || 0;
    const transportadoraNome =
      firstFilled(pedido.transportadora_razao_social, pedido.transportadora_nome_fantasia, pedido.transportadora_nome, pedido.transportadora) || '';
    const transportadoraDoc = String(firstFilled(pedido.transportadora_cnpj_cpf, pedido.transportadora_cnpj, pedido.transportadora_cpf) || '');
    const transportadoraDigits = transportadoraDoc.replace(/\D/g, '');
    const transportadoraCnpj = transportadoraDigits.length > 11 ? transportadoraDoc : '';
    const transportadoraCpf = transportadoraDigits.length > 0 && transportadoraDigits.length <= 11 ? transportadoraDoc : '';

    // Priorizar a marca da instância Labor mesmo em rotas legadas que enviam
    // o fallback fixo da Aluforce.
    // Resolve a logo da empresa p/ TODAS as marcas (inclui aluforce, BRAND vazio).
    // Antes só calculava p/ labor-*/zyntra → na Aluforce a DANFE/espelho caía no
    // texto da razão social em vez da logo. Agora a DANFE usa a logo da empresa.
    let brandLogoDataUri = '';
    try {
      const { resolverCaminhoLogo } = require('../modules/_shared/services/empresa-config.service');
      const logoPath = resolverCaminhoLogo({});
      if (logoPath && fs.existsSync(logoPath)) {
        const ext = path.extname(logoPath).toLowerCase();
        const mime = ext === '.svg' ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : 'image/png';
        brandLogoDataUri = `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`;
      }
    } catch (_) {}

    const resolvedLogo = opts.logoDataUri || brandLogoDataUri || pedido.emitenteLogoUrl || '';

    return {
        marcaAguaClasse: opts.preview ? 'watermark-logo' : 'hidden',
        marcaAguaTexto: opts.preview && resolvedLogo ? '<img src="' + resolvedLogo + '" alt="Zyntra">' : '',
        avisoTopo: opts.preview ? 'DOCUMENTO DE PRÉVIA — NÃO POSSUI VALOR FISCAL' : '',
        _isPreview: opts.preview || false,
        paginaAtual: '1',
        paginaTotal: '1',
        codigoBarrasUrl: chave ? `https://barcodeapi.org/api/128/${chave}` : '',
        emitenteLogoUrl: resolvedLogo,
        portalConsultaUrl: 'www.nfe.fazenda.gov.br/portal',

        NFe: {
            infNFe: {
                ide: {
                    nNF: nfNumero,
                    serie: pedido.serie_nf || '1',
                    tpNF: '1',
                    natOp: pedido.natureza_operacao || 'Venda de Mercadoria',
                  dhEmi: fmtDate(pedido.data_emissao || pedido.faturado_em || pedido.created_at),
                  dhSaiEnt: fmtDate(pedido.data_faturamento || pedido.data_emissao || pedido.faturado_em || pedido.created_at),
                  _danfeHoraSaida: fmtTime(pedido.data_faturamento || pedido.data_emissao || pedido.faturado_em || pedido.created_at)
                },
                emit: {
                    xNome: pedido.empresa_razao_social || pedido.empresa_nome || '',
                    xFant: pedido.empresa_nome || pedido.empresa_razao_social || '',
                    CNPJ: pedido.empresa_cnpj || '',
                    CPF: '',
                    IE: pedido.empresa_ie || '',
                    IEST: '',
                    CRT: crtEmitente,
                    IM: '',
                    email: '',
                    enderEmit: {
                        xLgr: empLgr,
                        nro: empNro,
                        xCpl: '',
                        xBairro: pedido.empresa_bairro || '',
                        xMun: pedido.empresa_cidade || '',
                        UF: pedido.empresa_uf || '',
                        CEP: pedido.empresa_cep || '',
                        fone: pedido.empresa_telefone || ''
                    }
                },
                dest: {
                    xNome: pedido.cliente_razao_social || pedido.cliente_nome || '',
                    CNPJ: pedido.cliente_cnpj || '',
                    CPF: pedido.cliente_cpf || '',
                    IE: pedido.cliente_ie || '',
                    indIEDest: pedido.cliente_ie ? '1' : '9',
                    enderDest: {
                        xLgr: dstLgr,
                        nro: dstNro,
                        xCpl: '',
                        xBairro: pedido.cliente_bairro || '',
                        xMun: pedido.cliente_cidade || '',
                        UF: pedido.cliente_estado || '',
                        CEP: pedido.cliente_cep || '',
                        fone: pedido.cliente_telefone || ''
                    }
                },
                cobr: {
                    fat: {
                        nFat: nfNumero,
                    dVenc: vencFat,
                        vOrig: fmtMoney(valorBruto),
                        vLiq: fmtMoney(valorNF)
                    },
                    dup: dups
                },
                det: itens.map((item, i) => {
                  const subtotal = parseFloat(item.subtotal) || 0;
                  const aliqIcms = firstPositiveOrLast(item.aliquota_icms, item.icms_percent, item.produto_aliquota_icms, aliquotaIcmsPadrao);
                  const aliqIpi = firstPositiveOrLast(item.aliquota_ipi, item.produto_aliquota_ipi, aliquotaIpiPadrao);
                  const vIcms = parseFloat(firstFilled(item.icms_value, item.v_icms, subtotal * (aliqIcms / 100))) || 0;
                  // valor_ipi em pedido_itens tem DEFAULT 0.00 (não NULL) — mesmo problema das
                  // alíquotas: usar firstPositiveOrLast para não travar no zero de coluna nunca
                  // preenchida e cair no cálculo via alíquota resolvida.
                  const vIpi = firstPositiveOrLast(item.valor_ipi, item.v_ipi, subtotal * (aliqIpi / 100));
                  const bcIcms = parseFloat(firstFilled(item.bc_icms, aliqIcms > 0 ? (vIcms / (aliqIcms / 100)) : subtotal)) || subtotal;
                  return {
                    prod: {
                      cProd: item.codigo || String(i + 1).padStart(3, '0'),
                      xProd: item.descricao || '',
                      NCM: firstFilled(item.ncm, item.produto_ncm) || '',
                      CFOP: firstFilled(item.cfop, item.produto_cfop, cfopPadrao) || cfopPadrao,
                      uCom: item.unidade || 'UN',
                      qCom: fmtQty(item.quantidade),
                      vUnCom: fmtMoney(item.preco_unitario),
                      vProd: fmtMoney(item.subtotal)
                    },
                    _danfeCstCsosn: firstFilled(item.cst, item.csosn, item.produto_cst_icms, item.produto_csosn_icms, cstPadrao) || cstPadrao,
                    _danfeBcIcms: fmtMoney(bcIcms),
                    _danfeVIcms: fmtMoney(vIcms),
                    _danfePIcms: fmtMoney(aliqIcms),
                    _danfeVIpi: fmtMoney(vIpi),
                    _danfePIpi: fmtMoney(aliqIpi)
                  };
                }),
                total: (() => {
                    // Calcular totais de impostos a partir dos itens quando os campos do pedido estiverem zerados
                    const calcBcIcms = itens.reduce((s, item) => {
                      const aliqIcms = firstPositiveOrLast(item.aliquota_icms, item.icms_percent, item.produto_aliquota_icms, aliquotaIcmsPadrao);
                      const sub = parseFloat(item.subtotal) || 0;
                      const vIcmsItem = parseFloat(firstFilled(item.icms_value, item.v_icms)) || 0;
                      const bc = aliqIcms > 0 ? (vIcmsItem > 0 ? (vIcmsItem / (aliqIcms / 100)) : sub) : 0;
                      return s + bc;
                    }, 0);
                    const calcVIcms = itens.reduce((s, item) => {
                      const sub = parseFloat(item.subtotal) || 0;
                      const aliqIcms = firstPositiveOrLast(item.aliquota_icms, item.icms_percent, item.produto_aliquota_icms, aliquotaIcmsPadrao);
                      return s + (parseFloat(firstFilled(item.icms_value, item.v_icms, sub * aliqIcms / 100)) || 0);
                    }, 0);
                    const calcVIpi = itens.reduce((s, item) => {
                      const sub = parseFloat(item.subtotal) || 0;
                      const aliqIpi = firstPositiveOrLast(item.aliquota_ipi, item.produto_aliquota_ipi, aliquotaIpiPadrao);
                      return s + firstPositiveOrLast(item.valor_ipi, item.v_ipi, sub * aliqIpi / 100);
                    }, 0);
                    const calcVPis = itens.reduce((s, item) => {
                      const sub = parseFloat(item.subtotal) || 0;
                      const aliqPis = firstPositiveOrLast(item.pis_percent, item.produto_aliquota_pis, aliquotaPisPadrao);
                      return s + (parseFloat(firstFilled(item.pis_value, sub * aliqPis / 100)) || 0);
                    }, 0);
                    const calcVCofins = itens.reduce((s, item) => {
                      const sub = parseFloat(item.subtotal) || 0;
                      const aliqCofins = firstPositiveOrLast(item.cofins_percent, item.produto_aliquota_cofins, aliquotaCofinsPadrao);
                      return s + (parseFloat(firstFilled(item.cofins_value, sub * aliqCofins / 100)) || 0);
                    }, 0);
                    // BUG-FIX 2026-06-28: mysql2 retorna DECIMAL como string ("0.00"), que é
                    // truthy em JS — "0.00" || calcVIcms nunca cai no calculado. parseFloat(...)
                    // antes do || converte a string em número (0 é falsy) para o fallback funcionar.
                    const pedTotalIcms = parseFloat(pedido.total_icms) || 0;
                    const pedBaseIcms = parseFloat(pedido.base_calculo_icms) || 0;
                    const pedTotalIpi = parseFloat(pedido.total_ipi) || 0;
                    const pedTotalPis = parseFloat(pedido.total_pis) || 0;
                    const pedTotalCofins = parseFloat(pedido.total_cofins) || 0;
                    const pedTotalImpostos = parseFloat(pedido.total_impostos) || 0;
                    return {
                    ICMSTot: {
                        vBC: fmtMoney(pedBaseIcms || calcBcIcms),
                        vICMS: fmtMoney(pedTotalIcms || calcVIcms),
                        vBCST: fmtMoney(pedido.base_calculo_icms_st || 0),
                        vST: fmtMoney(pedido.total_icms_st || 0),
                        vTotTrib: fmtMoney(pedTotalImpostos || (calcVIcms + calcVIpi + calcVPis + calcVCofins)),
                        vProd: fmtMoney(valorTotal),
                        vFCPSTRet: fmtMoney(pedido.total_fcp || 0),
                        vFrete: fmtMoney(frete),
                        vSeg: fmtMoney(seguro),
                        vDesc: fmtMoney(desconto),
                        vOutro: fmtMoney(outras),
                        vIPI: fmtMoney(pedTotalIpi || calcVIpi),
                        vPIS: fmtMoney(pedTotalPis || calcVPis),
                        vCOFINS: fmtMoney(pedTotalCofins || calcVCofins),
                        vNF: fmtMoney(valorNF),
                        vII: '0,00'
                    },
                    ISSQNtot: {
                        vServ: '',
                        vBC: '',
                        vISS: '',
                        cMunFG: ''
                    }
                    };
                })(),
                transp: {
                    modFrete: (() => {
                      const tf = String(pedido.tipo_frete || '').trim();
                      if (tf === '0' || tf.toUpperCase() === 'CIF') return '0 - Emitente';
                      if (tf === '1' || tf.toUpperCase() === 'FOB') return '1 - Destinat\u00e1rio';
                      if (tf === '2') return '2 - Terceiros';
                      if (tf === '9') return '9 - Sem Frete';
                      return tf ? tf : '1 - Destinat\u00e1rio';
                    })(),
                    transporta: {
                    xNome: transportadoraNome,
                    CNPJ: transportadoraCnpj,
                    CPF: transportadoraCpf,
                    IE: firstFilled(pedido.transportadora_ie, pedido.transportadora_inscricao_estadual) || '',
                    xEnder: firstFilled(pedido.transportadora_endereco) || '',
                    xMun: firstFilled(pedido.transportadora_cidade) || '',
                    UF: firstFilled(pedido.transportadora_uf, pedido.transportadora_estado) || ''
                    },
                    veicTransp: {
                        placa: pedido.placa_veiculo || '',
                        UF: pedido.veiculo_uf || '',
                    RNTC: firstFilled(pedido.rntrc, pedido.transportadora_rntrc) || ''
                    },
                  _danfeQVol: firstFilled(pedido.qtd_volumes, itens.length) || '',
                  _danfeEsp: firstFilled(pedido.especie_volumes, itens.length ? 'VOLUMES' : '') || '',
                  _danfeMarca: firstFilled(pedido.marca_volumes) || '',
                  _danfeNVol: firstFilled(pedido.numeracao_volumes) || '',
                  _danfePesoB: firstFilled(pedido.peso_bruto) || '',
                  _danfePesoL: firstFilled(pedido.peso_liquido) || ''
                },
                infAdProd: '',
                infAdic: {
                    infCpl: `Pedido N\u00ba ${pedido.id} | Condi\u00e7\u00e3o: ${
                        pedido.condicao_pagamento || pedido.parcelas || 'A Vista'
                    }${pedido.observacao ? '\n' + pedido.observacao : ''}`,
                    infAdFisco: ''
                }
            }
        },
        protNFe: {
            infProt: {
                chNFe: chave,
                nProt: pedido.nfe_protocolo || 'Homologa\u00e7\u00e3o',
                dhRecbto: fmtDate(pedido.data_faturamento || pedido.data_autorizacao || pedido.created_at)
            }
        }
    };
}

module.exports = { renderDanfe, buildDanfeCtx };
