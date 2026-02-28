const fs = require('fs');
const FILE = '/var/www/aluforce/modules/Vendas/public/estoque.html';

let raw = fs.readFileSync(FILE, 'utf8');
const hasCRLF = raw.includes('\r\n');
console.log('CRLF:', hasCRLF, '| Len:', raw.length);

// Normalize: CRLF→LF, strip trailing whitespace per line
let c = raw.replace(/\r\n/g, '\n');
let trimmed = c.replace(/[ \t]+\n/g, '\n');
let n = 0;

function rep(label, old, nw) {
    // Try on trimmed version
    if (trimmed.includes(old)) {
        trimmed = trimmed.replace(old, nw);
        n++;
        console.log('  OK ' + label);
    } else {
        console.log('  SKIP ' + label + ' (not found)');
    }
}

// 1. width - already done by first script
// 2. gradient - already done by first script

// 3. Product name bullet
rep('3-bullet',
    ".modal-produto-nome {\n            font-size: 18px;\n            font-weight: 700;\n            color: #0f172a;\n            margin-bottom: 12px;\n            line-height: 1.4;\n            display: flex;\n            align-items: flex-start;\n            gap: 8px;\n        }\n\n        .modal-produto-nome::before {\n            content: '*';\n            color: #3b82f6;\n            font-size: 12px;\n            margin-top: 4px;\n        }",
    ".modal-produto-nome {\n            font-size: 17px;\n            font-weight: 700;\n            color: #0f172a;\n            margin-bottom: 14px;\n            line-height: 1.45;\n            display: flex;\n            align-items: flex-start;\n            gap: 10px;\n            letter-spacing: -0.2px;\n        }\n\n        .modal-produto-nome::before {\n            content: '\\2022';\n            color: #3b82f6;\n            font-size: 18px;\n            margin-top: 0;\n            line-height: 1.45;\n        }"
);

// 4. Estoque card - already done in v2 run

// 5. Quantity
rep('5-quantidade',
    ".estoque-card-quantidade {\n            font-size: 36px;\n            font-weight: 800;\n            color: #0f172a;\n            line-height: 1;\n            display: flex;\n            align-items: baseline;\n            gap: 8px;\n        }\n\n        .estoque-card-quantidade small {\n            font-size: 16px;\n            font-weight: 500;\n            color: #64748b;\n        }",
    ".estoque-card-quantidade {\n            font-size: 38px;\n            font-weight: 800;\n            color: #0f172a;\n            line-height: 1;\n            display: flex;\n            align-items: baseline;\n            gap: 8px;\n            letter-spacing: -1px;\n        }\n\n        .estoque-card-quantidade small {\n            font-size: 18px;\n            font-weight: 600;\n            color: #475569;\n            letter-spacing: 0.5px;\n        }"
);

// 6. Progress bar - already done in v2

// 8. Price card
rep('8-preco',
    ".preco-card {\n            background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);\n            border-radius: 12px;\n            padding: 20px 24px;\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n            border: 1px solid #a7f3d0;\n        }\n\n        .preco-label {\n            font-size: 14px;\n            color: #047857;\n            font-weight: 600;\n        }\n\n        .preco-valor {\n            font-size: 32px;\n            font-weight: 800;\n            color: #059669;\n            font-family: 'Inter', sans-serif;\n            letter-spacing: -0.5px;\n        }",
    ".preco-card {\n            background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%);\n            border-radius: 14px;\n            padding: 22px 28px;\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n            border: 1px solid #6ee7b7;\n            box-shadow: 0 2px 8px rgba(5,150,105,0.08), 0 4px 16px rgba(5,150,105,0.04);\n            position: relative;\n            overflow: hidden;\n        }\n\n        .preco-card::before {\n            content: '';\n            position: absolute;\n            top: -30px;\n            right: -30px;\n            width: 80px;\n            height: 80px;\n            background: radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 70%);\n            border-radius: 50%;\n        }\n\n        .preco-label {\n            font-size: 14px;\n            color: #047857;\n            font-weight: 600;\n            letter-spacing: 0.2px;\n        }\n\n        .preco-valor {\n            font-size: 34px;\n            font-weight: 800;\n            color: #059669;\n            font-family: 'Inter', system-ui, sans-serif;\n            letter-spacing: -0.5px;\n            text-shadow: 0 1px 2px rgba(5,150,105,0.1);\n        }"
);

// 10. Section icon
rep('10-section-icon',
    ".modal-section-title i {\n            color: #3b82f6;\n            font-size: 14px;\n            width: 28px;\n            height: 28px;\n            background: #eff6ff;\n            border-radius: 8px;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n        }",
    ".modal-section-title i {\n            color: #3b82f6;\n            font-size: 15px;\n            width: 30px;\n            height: 30px;\n            background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);\n            border-radius: 8px;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            box-shadow: 0 1px 3px rgba(59,130,246,0.1);\n        }"
);

// 11. Close button
rep('11-close',
    ".modal-close:hover {\n            background: rgba(255,255,255,0.25);\n            transform: scale(1.05);\n        }",
    ".modal-close:hover {\n            background: rgba(255,255,255,0.3);\n            transform: scale(1.08);\n            box-shadow: 0 0 12px rgba(255,255,255,0.15);\n        }"
);

// 13. Scrollbar
rep('13-scrollbar',
    ".modal-body {\n            padding: 0;\n            overflow-y: auto;\n            max-height: calc(90vh - 80px);\n            background: #f8fafc;\n        }",
    ".modal-body {\n            padding: 0;\n            overflow-y: auto;\n            max-height: calc(90vh - 80px);\n            background: #f8fafc;\n            scrollbar-width: thin;\n            scrollbar-color: #cbd5e1 transparent;\n        }\n        .modal-body::-webkit-scrollbar {\n            width: 6px;\n        }\n        .modal-body::-webkit-scrollbar-track {\n            background: transparent;\n        }\n        .modal-body::-webkit-scrollbar-thumb {\n            background: #cbd5e1;\n            border-radius: 3px;\n        }\n        .modal-body::-webkit-scrollbar-thumb:hover {\n            background: #94a3b8;\n        }"
);

// 15. Detail item
rep('15-detail-item',
    ".detail-item span {\n            display: block;\n            font-size: 14px;\n            font-weight: 500;\n            color: #0f172a;\n            background: #f8fafc;\n            padding: 10px 12px;\n            border-radius: 8px;\n            border: 1px solid #e2e8f0;\n        }",
    ".detail-item span {\n            display: block;\n            font-size: 14px;\n            font-weight: 600;\n            color: #1e293b;\n            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);\n            padding: 10px 14px;\n            border-radius: 10px;\n            border: 1px solid #e2e8f0;\n            transition: border-color 0.2s ease;\n        }\n        .detail-item span:hover {\n            border-color: #cbd5e1;\n        }"
);

// 16. Aviso info
rep('16-aviso-info',
    ".modal-aviso.info {\n            background: #f0f9ff;\n            color: #0369a1;\n            border: 1px solid #bae6fd;\n        }",
    ".modal-aviso.info {\n            background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);\n            color: #0369a1;\n            border: 1px solid #bae6fd;\n            box-shadow: 0 1px 4px rgba(3,105,161,0.06);\n        }"
);

// 17. Aviso sync
rep('17-aviso-sync',
    ".modal-aviso.sync {\n            background: #f0fdf4;\n            color: #15803d;\n            border: 1px solid #bbf7d0;\n        }",
    ".modal-aviso.sync {\n            background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);\n            color: #15803d;\n            border: 1px solid #bbf7d0;\n            box-shadow: 0 1px 4px rgba(21,128,61,0.06);\n        }"
);

// Restore CRLF
if (hasCRLF) {
    trimmed = trimmed.replace(/\n/g, '\r\n');
}

fs.writeFileSync(FILE, trimmed, 'utf8');
console.log('\nTotal: ' + n + ' improvements applied');
