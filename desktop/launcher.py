"""Material Tracker desktop app (Windows .exe).

Reads config.ini next to the .exe:
  [tracker]
  server_url = https://your-tracker.up.railway.app   <- cloud mode: same data as phones
  server_url =                                       <- blank: runs a private local copy on this PC
"""
import configparser
import os
import socket
import sys
import threading
import time
from pathlib import Path

import webview

APP_NAME = "Material Tracker"


def base_dir():
    return Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent


def data_dir():
    p = Path(os.environ.get("APPDATA", Path.home())) / "MaterialTracker"
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_config():
    cfg = configparser.ConfigParser()
    path = base_dir() / "config.ini"
    if not path.exists():
        path.write_text("[tracker]\n# Paste your website address here to share data with phones.\n"
                        "# Leave it blank to keep a private copy on this computer.\nserver_url =\n")
    cfg.read(path)
    return (cfg.get("tracker", "server_url", fallback="") or "").strip().rstrip("/")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_local_server():
    os.environ.setdefault("MTRACK_DATA_DIR", str(data_dir()))
    sys.path.insert(0, str(base_dir()))
    from waitress import serve
    from server import create_app
    app = create_app()
    port = free_port()
    threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=port, threads=6), daemon=True).start()
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    return f"http://127.0.0.1:{port}"


def main():
    url = read_config() or start_local_server()
    webview.create_window(APP_NAME, url, width=1360, height=880, min_size=(900, 600), background_color="#070B14")
    webview.start(private_mode=False, storage_path=str(data_dir() / "webview"))


if __name__ == "__main__":
    main()
