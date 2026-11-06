# PyInstaller spec — run from the repo root:  pyinstaller desktop/build.spec
import os
root = os.path.abspath(os.path.join(SPECPATH, '..'))

a = Analysis(
    [os.path.join(root, 'desktop', 'launcher.py')],
    pathex=[root],
    datas=[(os.path.join(root, 'web'), 'web'), (os.path.join(root, 'server'), 'server')],
    hiddenimports=['server', 'server.api', 'server.models', 'server.logic', 'waitress', 'flask_sqlalchemy', 'fitz', 'sqlalchemy.dialects.sqlite'],
    excludes=['tkinter'],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='MaterialTracker',
    icon=os.path.join(root, 'web', 'icons', 'app.ico'),
    console=False, upx=False,
)
