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
    data_dir = _data_dir()
    url = os.environ.get("DATABASE_URL") or f"sqlite:///{data_dir / 'tracker.db'}"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=url,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        SECRET_KEY=_secret(data_dir),
        MAX_CONTENT_LENGTH=60 * 1024 * 1024,
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
