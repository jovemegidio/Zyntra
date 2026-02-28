#!/usr/bin/env python3
"""
Inject sidebar-click-animation.js into ALL module HTML files that have a sidebar.
Excludes: RH module (as requested), _shared, config, backup directories.
Adds the script tag right before </body> if not already present.
"""

import os
import glob

BASE = r"g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"
MODULES_DIR = os.path.join(BASE, "modules")

# Script tag to inject
SCRIPT_TAG = '<script src="/js/sidebar-click-animation.js?v=20260224"></script>'

# Modules to skip
SKIP_MODULES = {'RH', '_shared', 'config', 'desktop.ini'}

# Directories to skip within modules
SKIP_DIRS = {'_backup', 'backup', 'Backup', '_backups', 'node_modules', 'Zyntra-SGE'}

injected_files = []
skipped_files = []
already_has = []
no_sidebar = []
errors = []

for module_name in os.listdir(MODULES_DIR):
    module_path = os.path.join(MODULES_DIR, module_name)
    if not os.path.isdir(module_path):
        continue
    if module_name in SKIP_MODULES:
        continue
    
    # Find all HTML files recursively
    for root, dirs, files in os.walk(module_path):
        # Skip backup directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('_backup')]
        
        for fname in files:
            if not fname.endswith('.html'):
                continue
            
            filepath = os.path.join(root, fname)
            rel_path = os.path.relpath(filepath, BASE)
            
            try:
                # Try multiple encodings
                content = None
                used_encoding = None
                for enc in ['utf-8', 'latin-1', 'cp1252']:
                    try:
                        with open(filepath, 'r', encoding=enc) as f:
                            content = f.read()
                        used_encoding = enc
                        break
                    except UnicodeDecodeError:
                        continue
                
                if content is None:
                    errors.append((rel_path, 'Could not decode with any encoding'))
                    continue
                
                # Skip if no sidebar
                if '<aside class="sidebar"' not in content and 'class="sidebar"' not in content:
                    no_sidebar.append(rel_path)
                    continue
                
                # Skip if already has the script
                if 'sidebar-click-animation.js' in content:
                    already_has.append(rel_path)
                    continue
                
                # Find insertion point: before </body>
                body_close_idx = content.rfind('</body>')
                if body_close_idx == -1:
                    skipped_files.append((rel_path, 'no </body> tag'))
                    continue
                
                # Insert the script tag before </body>
                indent = '    '
                new_content = (
                    content[:body_close_idx] +
                    f'\n{indent}<!-- Sidebar Click Animation -->\n'
                    f'{indent}{SCRIPT_TAG}\n'
                    + content[body_close_idx:]
                )
                
                with open(filepath, 'w', encoding=used_encoding) as f:
                    f.write(new_content)
                
                injected_files.append(rel_path)
                
            except Exception as e:
                errors.append((rel_path, str(e)))

print(f"=== SIDEBAR ANIMATION INJECTION REPORT ===")
print(f"\n✅ INJECTED ({len(injected_files)} files):")
for f in sorted(injected_files):
    print(f"   {f}")

if already_has:
    print(f"\n⏩ ALREADY HAS ({len(already_has)} files):")
    for f in sorted(already_has):
        print(f"   {f}")

if no_sidebar:
    print(f"\n⬜ NO SIDEBAR ({len(no_sidebar)} files):")
    for f in sorted(no_sidebar):
        print(f"   {f}")

if skipped_files:
    print(f"\n⚠️ SKIPPED ({len(skipped_files)} files):")
    for f, reason in sorted(skipped_files):
        print(f"   {f} — {reason}")

if errors:
    print(f"\n❌ ERRORS ({len(errors)}):")
    for f, err in sorted(errors):
        print(f"   {f} — {err}")

print(f"\n📊 TOTALS: {len(injected_files)} injected, {len(already_has)} already had, {len(no_sidebar)} no sidebar, {len(skipped_files)} skipped, {len(errors)} errors")
