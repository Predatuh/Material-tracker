import json
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()


def now():
    return datetime.utcnow()


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


class JSONText(db.TypeDecorator):
    """JSON stored as text so it works the same on SQLite and Postgres."""
    impl = db.Text
    cache_ok = True

    def __init__(self, default_factory=list, *a, **kw):
        super().__init__(*a, **kw)
        self.default_factory = default_factory

    def process_bind_param(self, value, dialect):
        return json.dumps(value if value is not None else self.default_factory())

    def process_result_value(self, value, dialect):
        try:
            return json.loads(value) if value else self.default_factory()
        except Exception:
            return self.default_factory()


DEFAULT_STATUSES = [
    {"key": "todo", "label": "To do", "color": "#3B4B68", "done": False, "problem": False},
    {"key": "doing", "label": "Working", "color": "#FFB224", "done": False, "problem": False},
    {"key": "done", "label": "Done", "color": "#36D399", "done": True, "problem": False},
    {"key": "blocked", "label": "Problem", "color": "#FF5D4A", "done": False, "problem": True},
]


class Setting(db.Model):
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text)

    @staticmethod
    def get(key, default=None):
        row = db.session.get(Setting, key)
        return row.value if row else default

    @staticmethod
    def put(key, value):
        row = db.session.get(Setting, key)
        if not row:
            row = Setting(key=key)
            db.session.add(row)
        row.value = str(value)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False, unique=True)
    pin_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default="crew")  # foreman | lead | crew
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=now)

    def set_pin(self, pin):
        self.pin_hash = generate_password_hash(str(pin))

    def check_pin(self, pin):
        return check_password_hash(self.pin_hash, str(pin))

    @property
    def can_manage(self):
        return self.role in ("foreman", "lead")

    def to_dict(self):
        return {"id": self.id, "name": self.name, "role": self.role, "active": self.active}


class LocType(db.Model):
    """A kind of place work is tracked against: Power block, Row, Transition, Inverter…"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(60), nullable=False)        # "Power block"
    plural = db.Column(db.String(60), default="")          # "Power blocks"
    short = db.Column(db.String(12), default="")           # "PB"
    parent_type_id = db.Column(db.Integer, nullable=True)  # Rows live inside a Power block
    shape = db.Column(db.String(10), default="area")       # area (outline) | pin (point, e.g. a transition)
    sort = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "plural": self.plural or self.name + "s", "short": self.short or "",
                "parent_type_id": self.parent_type_id, "shape": self.shape or "area", "sort": self.sort}


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    type_id = db.Column(db.Integer, db.ForeignKey("loc_type.id"), nullable=False)
    parent_id = db.Column(db.Integer, nullable=True)
    name = db.Column(db.String(80), nullable=False)
    zone = db.Column(db.String(60), default="")
    sort = db.Column(db.Integer, default=0)
    notes = db.Column(db.Text, default="")

    def to_dict(self):
        return {"id": self.id, "type_id": self.type_id, "parent_id": self.parent_id, "name": self.name,
                "zone": self.zone or "", "sort": self.sort, "notes": self.notes or ""}


class Tracker(db.Model):
    """What gets tracked, against which kind of location, and how.
    mode: steps  - every location works through ordered steps, each with a status
          status - one status per location
          qty    - a quantity per location against a target (ft pulled, strings landed…)"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    color = db.Column(db.String(20), default="#FFB224")
    type_id = db.Column(db.Integer, db.ForeignKey("loc_type.id"), nullable=False)
    mode = db.Column(db.String(10), default="steps")
    statuses = db.Column(JSONText(list), default=lambda: list(DEFAULT_STATUSES))
    fields = db.Column(JSONText(list), default=list)    # [{key,label,type:text|number|date|check|select,options:[]}]
    unit = db.Column(db.String(20), default="")         # qty mode: ft, strings, ea
    default_target = db.Column(db.Float, default=0)
    scope = db.Column(JSONText(dict), default=dict)     # {mode: all|parents|zones|pick, ids:[], zones:[]}
    claims = db.Column(db.Boolean, default=True)        # track who's on it
    show_map = db.Column(db.Boolean, default=True)
    description = db.Column(db.Text, default="")
    due_date = db.Column(db.String(20), default="")
    status = db.Column(db.String(20), default="active")  # active | hold | done
    sort = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=now)
    steps = db.relationship("Step", backref="tracker", cascade="all, delete-orphan", order_by="Step.sort")
    materials = db.relationship("TrackerMaterial", backref="tracker", cascade="all, delete-orphan")

    def status_list(self):
        return self.statuses or list(DEFAULT_STATUSES)

    def done_keys(self):
        return {s["key"] for s in self.status_list() if s.get("done")}

    def to_dict(self):
        return {"id": self.id, "name": self.name, "color": self.color, "type_id": self.type_id, "mode": self.mode,
                "statuses": self.status_list(), "fields": self.fields or [], "unit": self.unit or "",
                "default_target": self.default_target or 0, "scope": self.scope or {"mode": "all"},
                "claims": self.claims, "show_map": self.show_map, "description": self.description or "",
                "due_date": self.due_date or "", "status": self.status, "sort": self.sort,
                "steps": [s.to_dict() for s in self.steps], "materials": [m.to_dict() for m in self.materials]}


class Step(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    tracker_id = db.Column(db.Integer, db.ForeignKey("tracker.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    sort = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "sort": self.sort}


class Entry(db.Model):
    """Progress of one tracker on one location (and one step, or step_id=0)."""
    id = db.Column(db.Integer, primary_key=True)
    tracker_id = db.Column(db.Integer, db.ForeignKey("tracker.id", ondelete="CASCADE"), nullable=False)
    location_id = db.Column(db.Integer, db.ForeignKey("location.id", ondelete="CASCADE"), nullable=False)
    step_id = db.Column(db.Integer, default=0, nullable=False)
    status = db.Column(db.String(30), default="todo")
    qty = db.Column(db.Float, default=0)
    target = db.Column(db.Float, nullable=True)  # qty mode override for this location
    values = db.Column(JSONText(dict), default=dict)
    crew = db.Column(JSONText(list), default=list)
    note = db.Column(db.Text, default="")
    updated_by = db.Column(db.String(80))
    updated_at = db.Column(db.DateTime, default=now)
    __table_args__ = (db.UniqueConstraint("tracker_id", "location_id", "step_id"),)

    def to_dict(self):
        return {"t": self.tracker_id, "l": self.location_id, "s": self.step_id, "status": self.status,
                "qty": self.qty or 0, "target": self.target, "values": self.values or {}, "crew": self.crew or [],
                "note": self.note or "", "by": self.updated_by, "at": iso(self.updated_at)}


class Material(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    part_no = db.Column(db.String(80), default="")
    category = db.Column(db.String(80), default="")
    unit = db.Column(db.String(20), default="ea")
    on_hand = db.Column(db.Float, default=0)
    out_qty = db.Column(db.Float, default=0)
    on_order = db.Column(db.Float, default=0)
    installed = db.Column(db.Float, default=0)
    reorder_point = db.Column(db.Float, default=0)
    extra_need = db.Column(db.Float, default=0)
    location = db.Column(db.String(120), default="")
    notes = db.Column(db.Text, default="")

    def to_dict(self):
        return {"id": self.id, "name": self.name, "part_no": self.part_no or "", "category": self.category or "",
                "unit": self.unit or "ea", "on_hand": self.on_hand or 0, "out_qty": self.out_qty or 0,
                "on_order": self.on_order or 0, "installed": self.installed or 0,
                "reorder_point": self.reorder_point or 0, "extra_need": self.extra_need or 0,
                "location": self.location or "", "notes": self.notes or ""}


class TrackerMaterial(db.Model):
    """Material one location takes for a tracker (per step, step_id 0 = whole tracker).
    In qty mode the quantity is per unit (e.g. per ft pulled)."""
    id = db.Column(db.Integer, primary_key=True)
    tracker_id = db.Column(db.Integer, db.ForeignKey("tracker.id"), nullable=False)
    step_id = db.Column(db.Integer, default=0)
    material_id = db.Column(db.Integer, db.ForeignKey("material.id", ondelete="CASCADE"), nullable=False)
    qty = db.Column(db.Float, default=0)

    def to_dict(self):
        return {"id": self.id, "step_id": self.step_id or 0, "material_id": self.material_id, "qty": self.qty or 0}


class Txn(db.Model):
    """Every material movement. kind: receive | grab | return | used | order | count | scrap"""
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.Integer, db.ForeignKey("material.id", ondelete="CASCADE"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    qty = db.Column(db.Float, default=0)
    source = db.Column(db.String(10), default="")
    person = db.Column(db.String(80), default="")
    location_id = db.Column(db.Integer, nullable=True)
    tracker_id = db.Column(db.Integer, nullable=True)
    note = db.Column(db.Text, default="")
    expected = db.Column(db.String(20), default="")
    by = db.Column(db.String(80))
    at = db.Column(db.DateTime, default=now)

    def to_dict(self):
        return {"id": self.id, "material_id": self.material_id, "kind": self.kind, "qty": self.qty,
                "source": self.source or "", "person": self.person or "", "location_id": self.location_id,
                "tracker_id": self.tracker_id, "note": self.note or "", "expected": self.expected or "",
                "by": self.by, "at": iso(self.at)}


class SiteMap(db.Model):
    """A plan image. location_id empty = the whole site; set = the map for one PB (rows, transitions)."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), default="Site plan")
    location_id = db.Column(db.Integer, nullable=True)
    data = db.Column(db.LargeBinary)
    mime = db.Column(db.String(40))
    width = db.Column(db.Integer)
    height = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=now)

    def to_dict(self):
        v = int(self.created_at.timestamp()) if self.created_at else 0
        return {"id": self.id, "name": self.name, "location_id": self.location_id, "width": self.width,
                "height": self.height, "url": f"/api/map/{self.id}/image?v={v}"}


class Area(db.Model):
    """Outline (3+ points) or pin (1 point) on a map, tied to a location. Points are % of the image."""
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey("site_map.id", ondelete="CASCADE"), nullable=False)
    location_id = db.Column(db.Integer, nullable=True)
    points = db.Column(JSONText(list), default=list)

    def to_dict(self):
        return {"id": self.id, "map_id": self.map_id, "location_id": self.location_id, "points": self.points or []}


class Drawing(db.Model):
    """An IFC / construction drawing file (PDF or image)."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    sheet = db.Column(db.String(40), default="")   # E-301
    rev = db.Column(db.String(20), default="")
    data = db.Column(db.LargeBinary)
    mime = db.Column(db.String(60))
    pages = db.Column(db.Integer, default=1)
    by = db.Column(db.String(80))
    created_at = db.Column(db.DateTime, default=now)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "sheet": self.sheet or "", "rev": self.rev or "",
                "mime": self.mime, "pages": self.pages or 1, "by": self.by, "at": iso(self.created_at),
                "is_pdf": (self.mime or "") == "application/pdf"}


class DrawingLink(db.Model):
    """Pins a drawing (or one page of it) to a location and/or a tracker."""
    id = db.Column(db.Integer, primary_key=True)
    drawing_id = db.Column(db.Integer, db.ForeignKey("drawing.id", ondelete="CASCADE"), nullable=False)
    page = db.Column(db.Integer, default=0)  # 0 = whole file / first page
    location_id = db.Column(db.Integer, nullable=True)
    tracker_id = db.Column(db.Integer, nullable=True)
    label = db.Column(db.String(120), default="")

    def to_dict(self):
        return {"id": self.id, "drawing_id": self.drawing_id, "page": self.page or 0,
                "location_id": self.location_id, "tracker_id": self.tracker_id, "label": self.label or ""}


class Activity(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    at = db.Column(db.DateTime, default=now, index=True)
    by = db.Column(db.String(80))
    kind = db.Column(db.String(20))
    text = db.Column(db.Text)

    def to_dict(self):
        return {"id": self.id, "at": iso(self.at), "by": self.by, "kind": self.kind, "text": self.text}
