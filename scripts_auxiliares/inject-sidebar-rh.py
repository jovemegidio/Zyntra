#!/usr/bin/env python3
"""Inject sidebar-click-animation.js into RH module HTML files."""
import os

BASE = r"g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
RH_DIR = os.path.join(BASE, "modules", "RH")
SCRIPT_TAG = '<script src="/js/sidebar-click-animation.js?v=20260224"></script>'

SKIP_DIRS = {'node_modules', 'screenshots', 'logs', 'tmp', 'patches', 'migrations', '.github', '.vscode', 'cloud-init', 'scripts'}

injected = []
already = []
no_sidebar = []
errors = []

for root, dirs, files in os.walk(RH_DIR):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for fname in files:
        if not fname.endswith('.html'):
            continue
        filepath = os.path.join(root, fname)
        rel = os.path.relpath(filepath, BASE)
        try:
            content = None
            enc = None
            for e in ['utf-8', 'latin-1', 'cp1252']:
                try:
                    with open(filepath, 'r', encoding=e) as f:
                        content = f.read()
                    enc = e
                    break
                except UnicodeDecodeError:
                    continue
            if content is None:
                errors.append((rel, 'decode error'))
                continue
            if 'class="sidebar"' not in content:
                no_sidebar.append(rel)
                continue
            if 'sidebar-click-animation.js' in content:
                already.append(rel)
                continue
            idx = content.rfind('</body>')
            if idx == -1:
                no_sidebar.append(rel)
                continue
            new_content = content[:idx] + '\n    <!-- Sidebar Click Animation -->\n    ' + SCRIPT_TAG + '\n' + content[idx:]
            with open(filepath, 'w', encoding=enc) as f:
                f.write(new_content)
            injected.append(rel)
        except Exception as ex:
            errors.append((rel, str(ex)))

print(f"=== RH MODULE INJECTION ===")
print(f"\n✅ INJECTED ({len(injected)}):")
for f in sorted(injected): print(f"   {f}")
if already:
    print(f"\n⏩ ALREADY ({len(already)}):")
    for f in sorted(already): print(f"   {f}")
if no_sidebar:
    print(f"\n⬜ NO SIDEBAR ({len(no_sidebar)}):")
    for f in sorted(no_sidebar): print(f"   {f}")
if errors:
    print(f"\n❌ ERRORS ({len(errors)}):")
    for f,e in sorted(errors): print(f"   {f} — {e}")
print(f"\n📊 {len(injected)} injected, {len(already)} already, {len(no_sidebar)} no sidebar, {len(errors)} errors")
