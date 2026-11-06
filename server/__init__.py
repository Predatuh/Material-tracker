import os
import secrets
import sys
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

from .models import Setting, db


def _base_dir():
    # When frozen by PyInstaller, bundled files live in sys._MEIPASS
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def _data_dir():
    d = os.environ.get("MTRACK_DATA_DIR")
    if d:
        p = Path(d)
    elif getattr(sys, "frozen", False):
        p = Path(os.environ.get("APPDATA", Path.home())) / "MaterialTracker"
    else:
        p = Path(__file__).resolve().parent.parent / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _secret(data_dir):
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    f = data_dir / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip()


def _add_missing_columns():
    """Tiny forward-only migration: add columns introduced after a database was first created."""
    from sqlalchemy import inspect, text
    wanted = {"location": [("code", "VARCHAR(80) DEFAULT ''")]}
    insp = inspect(db.engine)
    with db.engine.begin() as conn:
        for table, cols in wanted.items():
            if not insp.has_table(table):
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def create_app():
    web = _base_dir() / "web"
    app = Flask(__name__, static_folder=None)
    vol = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
    if vol and not os.environ.get("MTRACK_DATA_DIR"):
        os.environ["MTRACK_DATA_DIR"] = vol
    data_dir = _data_dir()
    url = os.environ.get("DATABASE_URL") or f"sqlite:///{data_dir / 'tracker.db'}"
    # On a cloud host with no database and no volume, the SQLite file is wiped on every restart.
    on_cloud = any(os.environ.get(k) for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RENDER", "DYNO", "FLY_APP_NAME"))
    ephemeral = on_cloud and not os.environ.get("DATABASE_URL") and not vol
    if ephemeral:
        print("WARNING: no DATABASE_URL — data will be lost on restart. Link a Postgres DATABASE_URL to this service.", flush=True)
    # Railway/Heroku give postgres:// or postgresql://. Pin the driver we ship (psycopg2) so a newer
    # SQLAlchemy that defaults to psycopg 3 doesn't crash on boot.
    for pre in ("postgres://", "postgresql://"):
        if url.startswith(pre):
            url = "postgresql+psycopg2://" + url[len(pre):]
            break
    app.config.update(
        SQLALCHEMY_DATABASE_URI=url,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        SECRET_KEY=_secret(data_dir),
        MAX_CONTENT_LENGTH=80 * 1024 * 1024,
        STORAGE_EPHEMERAL=ephemeral,
        SECRET_MISSING=on_cloud and not os.environ.get("SECRET_KEY"),
    )
    db.init_app(app)

    from .api import bp
    app.register_blueprint(bp)

    with app.app_context():
        db.create_all()
        _add_missing_columns()
        if url.startswith("sqlite"):
            from sqlalchemy import event
            @event.listens_for(db.engine, "connect")
            def _fk(conn, _):
                conn.execute("PRAGMA foreign_keys=ON")

    @app.errorhandler(404)
    def nf(e):
        return jsonify({"error": "Not found"}), 404

    @app.get("/sw.js")
    def sw():
        r = send_from_directory(web, "sw.js")
        r.headers["Cache-Control"] = "no-cache"
        r.headers["Service-Worker-Allowed"] = "/"
        return r

    @app.get("/")
    @app.get("/<path:path>")
    def spa(path="index.html"):
        f = web / path
        if path and f.is_file():
            resp = send_from_directory(web, path)
            if path.endswith((".js", ".css", ".html")):
                resp.headers["Cache-Control"] = "no-cache"
            return resp
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        resp = send_from_directory(web, "index.html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    return app
