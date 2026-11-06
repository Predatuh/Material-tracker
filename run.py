"""Run the tracker locally:  python run.py   then open http://localhost:5050"""
import os

from server import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    try:
        from waitress import serve
        print(f"Material Tracker running on http://localhost:{port}")
        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:
        app.run(host="0.0.0.0", port=port, debug=True)
