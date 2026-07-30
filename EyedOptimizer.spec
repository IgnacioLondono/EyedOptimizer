# EyedOptimizer.spec — PyInstaller
# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

block_cipher = None
root = Path(SPECPATH)

a = Analysis(
    ['main.py'],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(root / 'assets' / 'icon.ico'), 'assets'),
    ],
    hiddenimports=[
        'eyedoptimizer',
        'eyedoptimizer.app',
        'eyedoptimizer.themes',
        'eyedoptimizer.pages.dashboard',
        'eyedoptimizer.pages.optimizer',
        'eyedoptimizer.pages.task_manager',
        'eyedoptimizer.pages.settings',
        'eyedoptimizer.pages.games',
        'eyedoptimizer.services.system_monitor',
        'eyedoptimizer.services.hardware_info',
        'eyedoptimizer.services.gpu_monitor',
        'eyedoptimizer.services.ram_optimizer',
        'eyedoptimizer.services.process_manager',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'pandas'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='EyedOptimizer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(root / 'assets' / 'icon.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='EyedOptimizer',
)
