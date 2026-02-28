#!/usr/bin/env python3
"""Update the alerts card HTML header to add refresh button and scrollable container"""

filepath = r"g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2\modules\PCP\index.html"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

old_header = '''                            <span class="badge badge-danger" id="alerts-count">0</span>
                        </div>
                        <div class="card-body" id="alerts-container">'''

new_header = '''                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="badge badge-danger" id="alerts-count">0</span>
                                <button class="btn btn-sm btn-secondary" onclick="carregarAlertasSistema()" title="Atualizar Alertas" style="padding: 4px 8px;">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                            </div>
                        </div>
                        <div class="card-body" id="alerts-container" style="max-height: 500px; overflow-y: auto;">'''

if old_header in content:
    content = content.replace(old_header, new_header, 1)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Header updated!")
else:
    print("ERROR: Old header not found")
    # Try to find partial match
    idx = content.find('id="alerts-count"')
    if idx >= 0:
        print(f"Found alerts-count at position {idx}")
        print(f"Context: {repr(content[idx-50:idx+100])}")
