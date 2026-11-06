import csv
import io
import re
from collections import OrderedDict
from datetime import datetime, timedelta
from functools import wraps

from flask import Blueprint, Response, abort, current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .logic import KINDS, apply_txn, compute_needs, out_by_person, scope_locations
from .models import (DEFAULT_STATUSES, Activity, Area, Drawing, DrawingLink, Entry, Location, LocType, Material,
                     Setting, SiteMap, Step, Tracker, TrackerMaterial, Txn, User, db, now)

bp = Blueprint("api", __name__, url_prefix="/api")
TOKEN_DAYS = 120


# ── helpers ────────────────────────────────────────────────────────────

def _ser():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="mtrack")


def make_token(user):
    return _ser().dumps({"u": user.id})


def bump():
    Setting.put("rev", int(Setting.get("rev", 0) or 0) + 1)


def log(kind, text):
    db.session.add(Activity(by=g.user.name if getattr(g, "user", None) else None, kind=kind, text=text[:900]))


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fmt(q):
    return f"{q:g}"


def err(msg, code=400):
    return jsonify({"error": msg}), code


def get_or_404(model, ident):
    obj = db.session.get(model, ident)
    if not obj:
        abort(404)
    return obj


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_") or "x"


def auth(manage=False):
    def deco(fn):
        @wraps(fn)
        def inner(*a, **kw):
            raw = request.headers.get("Authorization", "").replace("Bearer ", "") or request.args.get("t", "")
            try:
                data = _ser().loads(raw, max_age=TOKEN_DAYS * 86400)
            except (BadSignature, SignatureExpired):
                return err("Sign in again — your session ran out.", 401)
            user = db.session.get(User, data.get("u"))
            if not user or not user.active:
                return err("This account is turned off. Ask the foreman.", 401)
            if manage and not user.can_manage:
                return err("Only the foreman or a lead can change this.", 403)
            g.user = user
            return fn(*a, **kw)
        return inner
    return deco


def done(**extra):
    bump()
    db.session.commit()
    return jsonify({"ok": True, "rev": int(Setting.get("rev", 0)), **extra})


def type_name(type_id, plural=False):
    t = db.session.get(LocType, type_id)
    if not t:
        return "locations" if plural else "location"
    return (t.plural or t.name + "s") if plural else t.name


# ── setup & auth ───────────────────────────────────────────────────────

@bp.get("/status")
def status():
    users = User.query.filter_by(active=True).order_by(User.name).all()
    return jsonify({"setup_needed": User.query.count() == 0, "job_name": Setting.get("job_name", ""),
                    "users": [u.name for u in users]})


@bp.post("/setup")
def setup():
    if User.query.count():
        return err("This job is already set up.")
    d = request.get_json() or {}
    name, pin = (d.get("name") or "").strip(), str(d.get("pin") or "").strip()
    if not name or not re.fullmatch(r"\d{4,8}", pin):
        return err("Enter your name and a 4–8 digit PIN.")
    Setting.put("job_name", (d.get("job_name") or "New job").strip())
    u = User(name=name, role="foreman")
    u.set_pin(pin)
    db.session.add(u)
    # Starting location types — all editable later
    pb = LocType(name="Power block", plural="Power blocks", short="PB", shape="area", sort=1)
    db.session.add(pb)
    db.session.flush()
    db.session.add(LocType(name="Row", plural="Rows", short="R", parent_type_id=pb.id, shape="area", sort=2))
    db.session.add(LocType(name="Transition", plural="Transitions", short="TR", parent_type_id=pb.id, shape="pin", sort=3))
    g.user = u
    log("setup", f"Started tracking {Setting.get('job_name')}")
    bump()
    db.session.commit()
    return jsonify({"token": make_token(u), "user": u.to_dict()})


@bp.post("/login")
def login():
    d = request.get_json() or {}
    u = User.query.filter(db.func.lower(User.name) == (d.get("name") or "").strip().lower()).first()
    if not u or not u.active or not u.check_pin(d.get("pin") or ""):
        return err("That name and PIN don't match.", 401)
    return jsonify({"token": make_token(u), "user": u.to_dict()})


@bp.get("/rev")
@auth()
def rev():
    return jsonify({"rev": int(Setting.get("rev", 0) or 0)})


@bp.get("/state")
@auth()
def state():
    since = now() - timedelta(days=60)
    return jsonify({
        "rev": int(Setting.get("rev", 0) or 0),
        "me": g.user.to_dict(),
        "job": {"name": Setting.get("job_name", ""),
                "crew_names": [n for n in (Setting.get("crew_names", "") or "").split("\n") if n.strip()]},
        "users": [u.to_dict() for u in User.query.order_by(User.name).all()],
        "types": [t.to_dict() for t in LocType.query.order_by(LocType.sort, LocType.id).all()],
        "locations": [l.to_dict() for l in Location.query.order_by(Location.sort, Location.id).all()],
        "trackers": [t.to_dict() for t in Tracker.query.order_by(Tracker.sort, Tracker.id).all()],
        "entries": [e.to_dict() for e in Entry.query.all()],
        "materials": [m.to_dict() for m in Material.query.order_by(Material.category, Material.name).all()],
        "txns": [t.to_dict() for t in Txn.query.filter(Txn.at >= since).order_by(Txn.at.desc()).limit(2000).all()],
        "out_by_person": out_by_person(),
        "maps": [m.to_dict() for m in SiteMap.query.order_by(SiteMap.id).all()],
        "areas": [a.to_dict() for a in Area.query.all()],
        "drawings": [d.to_dict() for d in Drawing.query.order_by(Drawing.sheet, Drawing.name).all()],
        "links": [l.to_dict() for l in DrawingLink.query.all()],
        "activity": [a.to_dict() for a in Activity.query.order_by(Activity.at.desc()).limit(150).all()],
    })


# ── job settings & people ──────────────────────────────────────────────

@bp.put("/settings")
@auth(manage=True)
def settings():
    d = request.get_json() or {}
    if "job_name" in d:
        Setting.put("job_name", (d["job_name"] or "").strip())
    if "crew_names" in d:
        names = [n.strip() for n in d["crew_names"] if n and n.strip()]
        Setting.put("crew_names", "\n".join(dict.fromkeys(names)))
    return done()


@bp.post("/users")
@auth(manage=True)
def add_user():
    d = request.get_json() or {}
    name, pin = (d.get("name") or "").strip(), str(d.get("pin") or "").strip()
    if not name or not re.fullmatch(r"\d{4,8}", pin):
        return err("Enter a name and a 4–8 digit PIN.")
    if User.query.filter(db.func.lower(User.name) == name.lower()).first():
        return err(f"{name} already has an account.")
    role = d.get("role") if d.get("role") in ("foreman", "lead", "crew") else "crew"
    if role == "foreman" and g.user.role != "foreman":
        return err("Only the foreman can add another foreman.", 403)
    u = User(name=name, role=role)
    u.set_pin(pin)
    db.session.add(u)
    log("crew", f"Added {name} as {role}")
    return done()


@bp.put("/users/<int:uid>")
@auth(manage=True)
def edit_user(uid):
    u = get_or_404(User, uid)
    d = request.get_json() or {}
    if "role" in d and d["role"] in ("foreman", "lead", "crew") and d["role"] != u.role:
        if g.user.role != "foreman":
            return err("Only the foreman can change roles.", 403)
        if u.id == g.user.id:
            return err("You can't change your own role.")
        u.role = d["role"]
    if "active" in d:
        if u.id == g.user.id:
            return err("You can't turn off your own account.")
        u.active = bool(d["active"])
    if d.get("pin"):
        if not re.fullmatch(r"\d{4,8}", str(d["pin"])):
            return err("PINs are 4–8 digits.")
        u.set_pin(d["pin"])
    return done()


# ── location types & locations ─────────────────────────────────────────

@bp.post("/types")
@auth(manage=True)
def add_type():
    d = request.get_json() or {}
    if not (d.get("name") or "").strip():
        return err("Name the location type, like Row or Inverter.")
    t = LocType(name=d["name"].strip(), plural=(d.get("plural") or "").strip() or d["name"].strip() + "s",
                short=(d.get("short") or "").strip(), parent_type_id=d.get("parent_type_id") or None,
                shape="pin" if d.get("shape") == "pin" else "area",
                sort=(db.session.query(db.func.max(LocType.sort)).scalar() or 0) + 1)
    db.session.add(t)
    db.session.flush()
    log("setup", f"Added location type {t.name}")
    return done(id=t.id)


@bp.put("/types/<int:tid>")
@auth(manage=True)
def edit_type(tid):
    t = get_or_404(LocType, tid)
    d = request.get_json() or {}
    for k in ("name", "plural", "short"):
        if k in d:
            setattr(t, k, (d[k] or "").strip())
    if "parent_type_id" in d:
        if d["parent_type_id"] and int(d["parent_type_id"]) == t.id:
            return err("A type can't be inside itself.")
        t.parent_type_id = d["parent_type_id"] or None
    if "shape" in d:
        t.shape = "pin" if d["shape"] == "pin" else "area"
    if "sort" in d:
        t.sort = int(d["sort"])
    return done()


@bp.delete("/types/<int:tid>")
@auth(manage=True)
def del_type(tid):
    t = get_or_404(LocType, tid)
    if Location.query.filter_by(type_id=tid).count():
        return err(f"Remove the {t.plural or t.name} first.")
    if Tracker.query.filter_by(type_id=tid).count():
        return err("A tracker still uses this type.")
    LocType.query.filter_by(parent_type_id=tid).update({"parent_type_id": None})
    log("setup", f"Removed location type {t.name}")
    db.session.delete(t)
    return done()


@bp.post("/locations")
@auth(manage=True)
def add_locations():
    """Either {type_id, names[], parent_id?} or a numbered run:
    {type_id, pattern:'{parent}-R{n}', start, end, pad, parent_ids[] | all_parents, zone}"""
    d = request.get_json() or {}
    lt = db.session.get(LocType, int(d.get("type_id") or 0))
    if not lt:
        return err("Pick a location type.")
    parents = [None]
    if d.get("all_parents") and lt.parent_type_id:
        parents = Location.query.filter_by(type_id=lt.parent_type_id).order_by(Location.sort, Location.id).all()
    elif d.get("parent_ids"):
        parents = Location.query.filter(Location.id.in_([int(x) for x in d["parent_ids"]])).order_by(Location.sort, Location.id).all()
    elif d.get("parent_id"):
        parents = [db.session.get(Location, int(d["parent_id"]))]
    if not parents:
        return err("There are no parent locations to add these under yet.")
    zone = (d.get("zone") or "").strip()
    names_in = [n.strip() for n in d.get("names", []) if n and str(n).strip()]
    plan = []  # (name, parent)
    if names_in:
        for p in parents:
            for n in names_in:
                plan.append((n.replace("{parent}", p.name if p else ""), p))
    else:
        start, end = int(d.get("start") or 1), int(d.get("end") or 0)
        if end < start or (end - start + 1) * len(parents) > 5000:
            return err("Check the number range.")
        pattern = d.get("pattern") or "{n}"
        if "{n}" not in pattern:
            pattern += "{n}"
        pad = int(d.get("pad") or 0)
        for p in parents:
            for i in range(start, end + 1):
                plan.append((pattern.replace("{parent}", p.name if p else "").replace("{n}", str(i).zfill(pad)), p))
    existing = {(l.type_id, l.parent_id, l.name.lower()) for l in Location.query.filter_by(type_id=lt.id).all()}
    base = (db.session.query(db.func.max(Location.sort)).scalar() or 0) + 1
    made = []
    for i, (n, p) in enumerate(plan):
        key = (lt.id, p.id if p else None, n.lower())
        if not n or key in existing:
            continue
        existing.add(key)
        loc = Location(type_id=lt.id, parent_id=p.id if p else None, name=n, zone=zone or (p.zone if p else ""),
                       sort=base + i)
        db.session.add(loc)
        made.append(loc)
    db.session.flush()
    log("setup", f"Added {len(made)} {(lt.plural or lt.name).lower()}")
    return done(ids=[l.id for l in made])


@bp.put("/locations/<int:lid>")
@auth(manage=True)
def edit_location(lid):
    l = get_or_404(Location, lid)
    d = request.get_json() or {}
    for k in ("name", "code", "zone", "notes"):
        if k in d:
            setattr(l, k, (d[k] or "").strip())
    if "parent_id" in d:
        l.parent_id = d["parent_id"] or None
    if "sort" in d:
        l.sort = int(d["sort"])
    return done()


def _delete_locations(ids):
    ids = set(ids)
    # include children recursively
    changed = True
    while changed:
        kids = {l.id for l in Location.query.filter(Location.parent_id.in_(ids)).all()} - ids
        changed = bool(kids)
        ids |= kids
    Entry.query.filter(Entry.location_id.in_(ids)).delete(synchronize_session=False)
    Area.query.filter(Area.location_id.in_(ids)).delete(synchronize_session=False)
    DrawingLink.query.filter(DrawingLink.location_id.in_(ids)).delete(synchronize_session=False)
    SiteMap.query.filter(SiteMap.location_id.in_(ids)).update({"location_id": None}, synchronize_session=False)
    n = Location.query.filter(Location.id.in_(ids)).delete(synchronize_session=False)
    return n


@bp.delete("/locations/<int:lid>")
@auth(manage=True)
def del_location(lid):
    l = get_or_404(Location, lid)
    n = _delete_locations([lid])
    log("setup", f"Removed {l.name}" + (f" and {n - 1} inside it" if n > 1 else ""))
    return done()


@bp.post("/locations/delete")
@auth(manage=True)
def del_locations():
    ids = [int(x) for x in (request.get_json() or {}).get("ids", [])]
    if not ids:
        return err("Nothing selected.")
    n = _delete_locations(ids)
    log("setup", f"Removed {n} locations")
    return done()


# ── trackers ───────────────────────────────────────────────────────────

FIELD_TYPES = ("text", "number", "date", "check", "select")


def _clean_statuses(raw):
    out, seen = [], set()
    for s in raw or []:
        label = (s.get("label") or "").strip()
        if not label:
            continue
        key = s.get("key") or slug(label)
        while key in seen:
            key += "_"
        seen.add(key)
        out.append({"key": key, "label": label, "color": s.get("color") or "#FFB224",
                    "done": bool(s.get("done")), "problem": bool(s.get("problem"))})
    if not out:
        return list(DEFAULT_STATUSES)
    if not any(s["done"] for s in out):
        out[-1]["done"] = True
    return out


def _clean_fields(raw):
    out, seen = [], set()
    for f in raw or []:
        label = (f.get("label") or "").strip()
        if not label:
            continue
        key = f.get("key") or slug(label)
        while key in seen:
            key += "_"
        seen.add(key)
        ftype = f.get("type") if f.get("type") in FIELD_TYPES else "text"
        opts = [o.strip() for o in (f.get("options") or []) if o and o.strip()] if ftype == "select" else []
        out.append({"key": key, "label": label, "type": ftype, "options": opts})
    return out


def _sync_tracker(t, d):
    for k in ("name", "color", "description", "due_date", "unit"):
        if k in d:
            setattr(t, k, (d[k] or "").strip())
    if d.get("type_id"):
        t.type_id = int(d["type_id"])
    if d.get("mode") in ("steps", "status", "qty"):
        t.mode = d["mode"]
    if d.get("status") in ("active", "hold", "done"):
        t.status = d["status"]
    for k in ("claims", "show_map"):
        if k in d:
            setattr(t, k, bool(d[k]))
    if "default_target" in d:
        t.default_target = num(d["default_target"])
    if "statuses" in d:
        t.statuses = _clean_statuses(d["statuses"])
    if "fields" in d:
        t.fields = _clean_fields(d["fields"])
    if "scope" in d:
        sc = d["scope"] or {}
        mode = sc.get("mode") if sc.get("mode") in ("all", "parents", "zones", "pick") else "all"
        t.scope = {"mode": mode, "ids": [int(x) for x in sc.get("ids") or []], "zones": list(sc.get("zones") or [])}
    if "steps" in d:
        keep = []
        for i, s in enumerate(d["steps"]):
            nm = (s.get("name") or "").strip()
            if not nm:
                continue
            step = db.session.get(Step, s["id"]) if s.get("id") else None
            if not step or step.tracker_id != t.id:
                step = Step(tracker=t)
                db.session.add(step)
            step.name, step.sort = nm, i
            keep.append(step)
        for s in list(t.steps):
            if s not in keep:
                Entry.query.filter_by(tracker_id=t.id, step_id=s.id).delete()
                TrackerMaterial.query.filter_by(tracker_id=t.id, step_id=s.id).update({"step_id": 0})
                t.steps.remove(s)
                db.session.delete(s)
        db.session.flush()
    if "materials" in d:
        for tm in list(t.materials):
            t.materials.remove(tm)
            db.session.delete(tm)
        steps = list(t.steps)
        for row in d["materials"]:
            if not row.get("material_id") or num(row.get("qty")) <= 0:
                continue
            step_id = 0
            si = row.get("step_index")
            if si is not None and str(si) != "" and 0 <= int(si) < len(steps):
                step_id = steps[int(si)].id
            t.materials.append(TrackerMaterial(material_id=int(row["material_id"]), step_id=step_id, qty=num(row["qty"])))


@bp.post("/trackers")
@auth(manage=True)
def add_tracker():
    d = request.get_json() or {}
    if not (d.get("name") or "").strip():
        return err("Give the tracker a name.")
    if not db.session.get(LocType, int(d.get("type_id") or 0)):
        return err("Pick what this tracker is tracked by.")
    t = Tracker(name=d["name"].strip(), type_id=int(d["type_id"]),
                sort=(db.session.query(db.func.max(Tracker.sort)).scalar() or 0) + 1)
    db.session.add(t)
    db.session.flush()
    _sync_tracker(t, d)
    log("tracker", f"Added tracker {t.name}")
    return done(id=t.id)


@bp.put("/trackers/<int:tid>")
@auth(manage=True)
def edit_tracker(tid):
    t = get_or_404(Tracker, tid)
    d = request.get_json() or {}
    if d.get("type_id") and int(d["type_id"]) != t.type_id:
        Entry.query.filter_by(tracker_id=t.id).delete()  # entries belonged to the old locations
    _sync_tracker(t, d)
    return done()


@bp.delete("/trackers/<int:tid>")
@auth(manage=True)
def del_tracker(tid):
    t = get_or_404(Tracker, tid)
    Entry.query.filter_by(tracker_id=tid).delete()
    DrawingLink.query.filter_by(tracker_id=tid).delete()
    log("tracker", f"Removed tracker {t.name}")
    db.session.delete(t)
    return done()


# ── progress entries ───────────────────────────────────────────────────

@bp.post("/entries")
@auth()
def set_entries():
    """{tracker_id, location_ids[], step_ids[] (omit for status/qty mode), status?, qty?, qty_add?, target?,
        values?, crew?, note?, log_materials?}"""
    d = request.get_json() or {}
    t = db.session.get(Tracker, int(d.get("tracker_id") or 0))
    if not t:
        return err("That tracker doesn't exist anymore.", 404)
    statuses = {s["key"]: s for s in t.status_list()}
    status = d.get("status")
    if status is not None and status not in statuses:
        return err("Unknown status for this tracker.")
    loc_ids = [int(x) for x in d.get("location_ids", [])]
    step_ids = [int(x) for x in d.get("step_ids", [])] if t.mode == "steps" else [0]
    valid_steps = {s.id for s in t.steps}
    step_ids = [s for s in step_ids if s == 0 or s in valid_steps] or ([0] if t.mode != "steps" else [])
    if t.mode == "steps" and not step_ids and status is None and ("values" in d or "note" in d):
        step_ids = [0]  # tracker-level fields on a location live on step 0
    locs = {l.id: l for l in Location.query.filter(Location.id.in_(loc_ids)).all()} if loc_ids else {}
    if not locs or not step_ids:
        return err("Pick at least one location" + (" and step." if t.mode == "steps" else "."))
    existing = {(e.location_id, e.step_id): e for e in
                Entry.query.filter(Entry.tracker_id == t.id, Entry.location_id.in_(list(locs)),
                                   Entry.step_id.in_(step_ids)).all()}
    first_key = t.status_list()[0]["key"]
    done_keys = t.done_keys()
    done_key = next(iter(done_keys))
    working_key = next((s["key"] for s in t.status_list() if not s["done"] and not s["problem"] and s["key"] != first_key), first_key)
    newly_done = []
    for lid in locs:
        for sid in step_ids:
            e = existing.get((lid, sid))
            if not e:
                e = Entry(tracker_id=t.id, location_id=lid, step_id=sid, status=first_key, qty=0, crew=[], values={})
                db.session.add(e)
            before = e.status
            if t.mode == "qty" and ("qty" in d or "qty_add" in d or "target" in d):
                if "target" in d:
                    e.target = None if d["target"] in (None, "") else num(d["target"])
                if "qty" in d:
                    e.qty = max(0.0, num(d["qty"]))
                if "qty_add" in d:
                    e.qty = max(0.0, (e.qty or 0) + num(d["qty_add"]))
                target = (e.target if e.target is not None else t.default_target) or 0
                if status is None and not statuses.get(e.status, {}).get("problem"):
                    e.status = done_key if target and e.qty >= target else (working_key if e.qty > 0 else first_key)
            if status is not None:
                e.status = status
            if "values" in d and isinstance(d["values"], dict):
                vals = dict(e.values or {})
                vals.update(d["values"])
                e.values = vals
            if d.get("crew") is not None:
                e.crew = [c for c in d["crew"] if c]
            if "note" in d:
                e.note = d["note"] or ""
            e.updated_by, e.updated_at = g.user.name, now()
            if e.status in done_keys and before not in done_keys:
                newly_done.append((lid, sid))
    if d.get("log_materials") and newly_done and t.mode != "qty":
        person = (d.get("crew") or [""])[0]
        for lid, sid in newly_done:
            for tm in t.materials:
                if ((t.mode == "steps" and tm.step_id == sid) or t.mode == "status") and tm.qty:
                    m = db.session.get(Material, tm.material_id)
                    if not m:
                        continue
                    src = "out" if m.out_qty >= tm.qty else "stock"
                    tx = Txn(material_id=m.id, kind="used", qty=tm.qty, source=src, person=person, location_id=lid,
                             tracker_id=t.id, note="Logged when marked done", by=g.user.name)
                    apply_txn(m, tx)
                    db.session.add(tx)
    # activity line
    names = sorted(locs[l].name for l in locs)
    where = ", ".join(names[:6]) + (f" +{len(names) - 6} more" if len(names) > 6 else "")
    if t.mode == "steps":
        what = ", ".join(s.name for s in t.steps if s.id in step_ids)
        label = statuses[status]["label"] if status else "updated"
        log("progress", f"{t.name}: {what} → {label} on {where}")
    elif t.mode == "qty" and ("qty" in d or "qty_add" in d):
        amt = fmt(num(d.get("qty_add"))) if "qty_add" in d else f"set to {fmt(num(d.get('qty')))}"
        log("progress", f"{t.name}: {'+' if 'qty_add' in d else ''}{amt} {t.unit} on {where}")
    else:
        log("progress", f"{t.name} → {statuses[status]['label'] if status else 'updated'} on {where}")
    return done()


# ── materials ──────────────────────────────────────────────────────────

MAT_FIELDS = ("name", "part_no", "category", "unit", "location", "notes")
MAT_NUMS = ("reorder_point", "extra_need")


@bp.post("/materials")
@auth(manage=True)
def add_material():
    d = request.get_json() or {}
    if not (d.get("name") or "").strip():
        return err("Give the material a name.")
    m = Material()
    for k in MAT_FIELDS:
        setattr(m, k, (d.get(k) or "").strip())
    for k in MAT_NUMS:
        setattr(m, k, num(d.get(k)))
    m.on_hand, m.out_qty, m.on_order, m.installed = num(d.get("on_hand")), 0, num(d.get("on_order")), 0
    m.unit = m.unit or "ea"
    db.session.add(m)
    db.session.flush()
    log("material", f"Added {m.name} ({fmt(m.on_hand)} {m.unit} on hand)")
    return done(id=m.id)


@bp.put("/materials/<int:mid>")
@auth(manage=True)
def edit_material(mid):
    m = get_or_404(Material, mid)
    d = request.get_json() or {}
    for k in MAT_FIELDS:
        if k in d:
            setattr(m, k, (d[k] or "").strip())
    for k in MAT_NUMS:
        if k in d:
            setattr(m, k, num(d[k]))
    return done()


@bp.delete("/materials/<int:mid>")
@auth(manage=True)
def del_material(mid):
    m = get_or_404(Material, mid)
    Txn.query.filter_by(material_id=mid).delete()
    TrackerMaterial.query.filter_by(material_id=mid).delete()
    log("material", f"Removed {m.name}")
    db.session.delete(m)
    return done()


@bp.post("/materials/import")
@auth(manage=True)
def import_materials():
    text = (request.get_json() or {}).get("csv", "")
    rows = list(csv.DictReader(io.StringIO(text.strip())))
    if not rows:
        return err("Paste CSV with a header row (name, part_no, category, unit, on_hand…).")
    norm = lambda s: re.sub(r"[^a-z]", "_", (s or "").strip().lower()).strip("_")
    by_name = {m.name.lower(): m for m in Material.query.all()}
    added = updated = 0
    for r in rows:
        r = {norm(k): (v or "").strip() for k, v in r.items() if k}
        name = r.get("name") or r.get("material") or r.get("description") or r.get("item")
        if not name:
            continue
        m = by_name.get(name.lower())
        if not m:
            m = Material(name=name, on_hand=0, out_qty=0, on_order=0, installed=0)
            db.session.add(m)
            by_name[name.lower()] = m
            added += 1
        else:
            updated += 1
        for k in ("part_no", "category", "unit", "location", "notes"):
            if r.get(k):
                setattr(m, k, r[k])
        for k in ("on_hand", "on_order", "reorder_point", "extra_need"):
            if r.get(k):
                setattr(m, k, num(r[k]))
        m.unit = m.unit or "ea"
    log("material", f"Imported materials: {added} new, {updated} updated")
    return done(added=added, updated=updated)


@bp.post("/txns")
@auth()
def add_txn():
    d = request.get_json() or {}
    kind = d.get("kind")
    if kind not in KINDS:
        return err("Unknown movement type.")
    if kind in ("order", "count", "scrap") and not g.user.can_manage:
        return err("Only the foreman or a lead can do that.", 403)
    m = db.session.get(Material, int(d.get("material_id") or 0))
    if not m:
        return err("That material doesn't exist anymore.", 404)
    qty = num(d.get("qty"))
    if kind != "count" and qty <= 0:
        return err("Enter a quantity above zero.")
    t = Txn(material_id=m.id, kind=kind, person=(d.get("person") or "").strip(), note=(d.get("note") or "").strip(),
            location_id=d.get("location_id") or None, tracker_id=d.get("tracker_id") or None,
            expected=(d.get("expected") or "").strip(), by=g.user.name, source=d.get("source") or "")
    t.qty = round(qty - (m.on_hand or 0), 4) if kind == "count" else qty
    if kind == "used" and t.source not in ("out", "stock"):
        t.source = "out" if (m.out_qty or 0) >= qty else "stock"
    if kind == "receive" and not t.source:
        t.source = "order" if (m.on_order or 0) > 0 else ""
    if kind == "grab" and not t.person:
        t.person = g.user.name
    apply_txn(m, t)
    db.session.add(t)
    who = t.person or g.user.name
    verb = {"receive": "Received", "grab": "grabbed", "return": "returned", "used": "installed",
            "order": "Ordered", "count": "Counted", "scrap": "Scrapped"}[kind]
    if kind == "count":
        text = f"Counted {m.name}: {fmt(m.on_hand)} {m.unit} on hand ({'+' if t.qty >= 0 else ''}{fmt(t.qty)})"
    elif kind in ("grab", "return", "used"):
        text = f"{who} {verb} {fmt(qty)} {m.unit} {m.name}"
    else:
        text = f"{verb} {fmt(qty)} {m.unit} {m.name}"
    if t.location_id:
        loc = db.session.get(Location, int(t.location_id))
        if loc:
            text += f" at {loc.name}"
    log(kind, text)
    return done()


@bp.delete("/txns/<int:tid>")
@auth()
def undo_txn(tid):
    t = get_or_404(Txn, tid)
    mine_recent = t.by == g.user.name and (now() - t.at) < timedelta(minutes=30)
    if not (g.user.can_manage or mine_recent):
        return err("You can only undo your own entries from the last 30 minutes.", 403)
    m = db.session.get(Material, t.material_id)
    if m:
        apply_txn(m, t, -1)
        log("undo", f"Undid {t.kind} of {fmt(abs(t.qty))} {m.unit} {m.name}")
    db.session.delete(t)
    return done()


# ── drawings (IFC sets, PB sheets) ─────────────────────────────────────

_page_cache = OrderedDict()


def _fitz():
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz
    return fitz


def _render_page(dr, page, width):
    key = (dr.id, page, width, dr.created_at)
    if key in _page_cache:
        _page_cache.move_to_end(key)
        return _page_cache[key]
    fitz = _fitz()
    doc = fitz.open(stream=dr.data, filetype="pdf")
    p = doc[min(max(page, 1), len(doc)) - 1]
    zoom = width / max(p.rect.width, 1)
    png = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).tobytes("png")
    _page_cache[key] = png
    while len(_page_cache) > 60:
        _page_cache.popitem(last=False)
    return png


def _name_pattern(name):
    toks = re.findall(r"[A-Za-z]+|\d+", name)
    if not toks:
        return None
    parts = [("0*" + str(int(t))) if t.isdigit() else re.escape(t) for t in toks]
    return re.compile(r"(?<![A-Za-z0-9])" + r"[\s\-_./#]*".join(parts) + r"(?![0-9])", re.I)


def _auto_link(dr, type_id, max_per_page=3):
    """Find location names in each page's text and link those pages. Overview sheets that mention
    lots of locations are skipped so a PB only gets its own sheets."""
    fitz = _fitz()
    doc = fitz.open(stream=dr.data, filetype="pdf")
    locs = Location.query.filter_by(type_id=type_id).all()
    pats = [(l, [p for p in (_name_pattern(l.name), _name_pattern(l.code or "")) if p]) for l in locs]
    have = {(lk.page, lk.location_id) for lk in DrawingLink.query.filter_by(drawing_id=dr.id).all()}
    made = 0
    for i, page in enumerate(doc, start=1):
        text = page.get_text() or ""
        hits = [l for l, ps in pats if any(p.search(text) for p in ps) and (i, l.id) not in have]
        if not hits or len(hits) > max_per_page:
            continue
        for l in hits:
            db.session.add(DrawingLink(drawing_id=dr.id, page=i, location_id=l.id))
            made += 1
    return made


def _natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s or "")]


def _import_block_set(dr, opts):
    """IFC block-layout sets (one sheet per inverter/power block, e.g. 'DC BLOCK LAYOUT - INV31C105'):
    make or find a location per sheet, number them 1..N in sheet-number order, keep the sheet's ID as the
    location's code, link the page, and optionally add the transitions ('(3) TR 31C105-01') under each block."""
    fitz = _fitz()
    doc = fitz.open(stream=dr.data, filetype="pdf")
    title_re = re.compile(opts.get("title_regex") or r"LAYOUT\s*-\s*([A-Z0-9][A-Z0-9_\-]*[0-9])", re.I)
    sheet_re = re.compile(r"\b(?:[A-Z0-9]+-){2,}([0-9]{3,5})\b")
    tr_re = re.compile(r"\((\d+)\)\s*TR\s+([0-9A-Z]+-\d{1,3})", re.I)
    found = []
    for i, page in enumerate(doc, start=1):
        text = page.get_text() or ""
        m = title_re.search(text)
        if not m:
            continue
        code = m.group(1).upper()
        sheets = sheet_re.findall(text)
        own = code[3:] if code.startswith("INV") else code
        # a big hand-added number on the sheet (e.g. a red "27") is the crew's block number
        marks = [s["text"].strip() for b in page.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"]
                 if s["size"] >= 40 and s["text"].strip().isdigit()]
        found.append({"page": i, "code": code, "sheet": sheets[0] if sheets else "", "mark": int(marks[0]) if marks else None,
                      "trs": sorted({(t.upper(), int(n)) for n, t in tr_re.findall(text) if t.upper().startswith(own) or own not in text}, key=lambda x: _natkey(x[0]))})
    if not found:
        return {"blocks": 0, "linked": 0, "transitions": 0, "pages": 0}
    marks = [f["mark"] for f in found]
    by_mark = all(m is not None for m in marks) and len(set(marks)) == len(marks)
    if by_mark:
        found.sort(key=lambda f: f["mark"])
    elif all(f["sheet"] for f in found):
        found.sort(key=lambda f: int(f["sheet"]))
    else:
        found.sort(key=lambda f: _natkey(f["code"]))
    type_id = int(opts["type_id"])
    prefix = opts.get("prefix", "PB-")
    pad = max(2, len(str(len(found))))
    tr_type = int(opts["tr_type_id"]) if opts.get("tr_type_id") else None
    existing = Location.query.filter_by(type_id=type_id).all()
    by_code = {(l.code or "").upper(): l for l in existing if l.code}
    by_name = {l.name.upper(): l for l in existing}
    base = (db.session.query(db.func.max(Location.sort)).scalar() or 0) + 1
    made = linked = trs_made = 0
    if by_mark:
        pad = max(2, len(str(max(marks))))
    for n, f in enumerate(found, start=1):
        if by_mark:
            n = f["mark"]
        name = f"{prefix}{str(n).zfill(pad)}"
        loc = by_code.get(f["code"]) or by_name.get(f["code"]) or by_name.get(name.upper())
        if not loc:
            loc = Location(type_id=type_id, name=name, code=f["code"], sort=base + n)
            db.session.add(loc)
            db.session.flush()
            made += 1
        elif not loc.code:
            loc.code = f["code"]
        if not DrawingLink.query.filter_by(drawing_id=dr.id, page=f["page"], location_id=loc.id).first():
            db.session.add(DrawingLink(drawing_id=dr.id, page=f["page"], location_id=loc.id))
            linked += 1
        if tr_type and f["trs"]:
            kids = {k.name.upper() for k in Location.query.filter_by(type_id=tr_type, parent_id=loc.id).all()}
            for k, (tr, count) in enumerate(f["trs"]):
                tname = f"TR {tr}"
                if tname.upper() in kids:
                    continue
                db.session.add(Location(type_id=tr_type, parent_id=loc.id, name=tname, zone=loc.zone,
                                        notes=f"({count}) on IFC sheet", sort=base + n * 100 + k))
                trs_made += 1
    return {"blocks": made, "linked": linked, "transitions": trs_made, "pages": len(found),
            "numbered_by": "numbers marked on the sheets" if by_mark else "sheet number order" if all(f["sheet"] for f in found) else "sheet ID order"}


@bp.post("/drawings")
@auth(manage=True)
def upload_drawing():
    f = request.files.get("file")
    if not f:
        return err("Choose a drawing file.")
    raw, mime, fname = f.read(), (f.mimetype or ""), f.filename or "Drawing"
    is_pdf = fname.lower().endswith(".pdf") or mime == "application/pdf"
    if not is_pdf and not mime.startswith("image/"):
        return err("Upload a PDF, PNG or JPG.")
    pages = 1
    if is_pdf:
        mime = "application/pdf"
        try:
            fitz = _fitz()
            pages = len(fitz.open(stream=raw, filetype="pdf"))
        except ImportError:
            return err("PDF drawings need PyMuPDF on the server.")
        except Exception:
            return err("That PDF couldn't be opened.")
    fm = request.form
    dr = Drawing(name=(fm.get("name") or re.sub(r"\.[a-z0-9]+$", "", fname, flags=re.I)).strip(),
                 sheet=(fm.get("sheet") or "").strip(), rev=(fm.get("rev") or "").strip(),
                 data=raw, mime=mime, pages=pages, by=g.user.name)
    db.session.add(dr)
    db.session.flush()
    linked = 0
    if fm.get("tracker_id"):
        db.session.add(DrawingLink(drawing_id=dr.id, page=0, tracker_id=int(fm["tracker_id"])))
    if fm.get("location_id"):
        db.session.add(DrawingLink(drawing_id=dr.id, page=0, location_id=int(fm["location_id"])))
    blocks = None
    if is_pdf and fm.get("block_set") and fm.get("block_type_id"):
        blocks = _import_block_set(dr, {"type_id": fm["block_type_id"], "prefix": fm.get("block_prefix", "PB-"),
                                        "tr_type_id": fm.get("tr_type_id") or None})
        linked = blocks["linked"]
    elif is_pdf and fm.get("auto_type_id"):
        linked = _auto_link(dr, int(fm["auto_type_id"]))
    msg = f"Uploaded {dr.sheet + ' ' if dr.sheet else ''}{dr.name} ({pages} page{'s' if pages != 1 else ''})"
    if blocks:
        msg += f": {blocks['pages']} block sheets, {blocks['blocks']} new blocks, {blocks['transitions']} transitions"
    elif linked:
        msg += f", matched {linked} pages to locations"
    log("drawing", msg)
    return done(id=dr.id, linked=linked, blocks=blocks)


@bp.get("/drawings/<int:did>/file")
@auth()
def drawing_file(did):
    dr = get_or_404(Drawing, did)
    ext = "pdf" if dr.mime == "application/pdf" else (dr.mime or "image/png").split("/")[-1]
    return Response(dr.data, mimetype=dr.mime, headers={
        "Content-Disposition": f'inline; filename="{(dr.sheet + " " if dr.sheet else "") + dr.name}.{ext}"'})


@bp.get("/drawings/<int:did>/page/<int:page>")
@auth()
def drawing_page(did, page):
    dr = get_or_404(Drawing, did)
    if dr.mime != "application/pdf":
        return Response(dr.data, mimetype=dr.mime, headers={"Cache-Control": "private, max-age=604800"})
    width = int(clamp_num(request.args.get("w"), 400, 4000, 1800))
    return Response(_render_page(dr, page, width), mimetype="image/png",
                    headers={"Cache-Control": "private, max-age=604800"})


def clamp_num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


@bp.put("/drawings/<int:did>")
@auth(manage=True)
def edit_drawing(did):
    dr = get_or_404(Drawing, did)
    d = request.get_json() or {}
    for k in ("name", "sheet", "rev"):
        if k in d:
            setattr(dr, k, (d[k] or "").strip())
    if d.get("auto_type_id") and dr.mime == "application/pdf":
        DrawingLink.query.filter(DrawingLink.drawing_id == dr.id, DrawingLink.location_id.isnot(None),
                                 DrawingLink.page > 0).delete(synchronize_session=False)
        n = _auto_link(dr, int(d["auto_type_id"]), int(d.get("max_per_page") or 3))
        log("drawing", f"Matched {n} pages of {dr.name} to locations")
        return done(linked=n)
    return done()


@bp.delete("/drawings/<int:did>")
@auth(manage=True)
def del_drawing(did):
    dr = get_or_404(Drawing, did)
    DrawingLink.query.filter_by(drawing_id=did).delete()
    log("drawing", f"Removed drawing {dr.name}")
    db.session.delete(dr)
    return done()


@bp.post("/drawing-links")
@auth(manage=True)
def add_links():
    d = request.get_json() or {}
    dr = db.session.get(Drawing, int(d.get("drawing_id") or 0))
    if not dr:
        return err("Pick a drawing.")
    page = int(d.get("page") or 0)
    if page > (dr.pages or 1):
        return err(f"That drawing only has {dr.pages} pages.")
    loc_ids = [int(x) for x in d.get("location_ids") or []]
    tracker_id = d.get("tracker_id") or None
    if not loc_ids and not tracker_id:
        return err("Link it to a location or a tracker.")
    for lid in loc_ids or [None]:
        db.session.add(DrawingLink(drawing_id=dr.id, page=page, location_id=lid, tracker_id=tracker_id,
                                   label=(d.get("label") or "").strip()))
    return done()


@bp.delete("/drawing-links/<int:lid>")
@auth(manage=True)
def del_link(lid):
    db.session.delete(get_or_404(DrawingLink, lid))
    return done()


# ── maps ───────────────────────────────────────────────────────────────

def _png_dims(raw):
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw))
        return im.size
    except Exception:
        return (None, None)


@bp.post("/map")
@auth(manage=True)
def upload_map():
    f = request.files.get("file")
    if not f:
        return err("Choose a plan file.")
    raw, mime, name = f.read(), (f.mimetype or ""), f.filename or "Plan"
    width = height = None
    if name.lower().endswith(".pdf") or mime == "application/pdf":
        try:
            fitz = _fitz()
        except ImportError:
            return err("PDF upload needs PyMuPDF on the server. Upload a PNG or JPG instead.")
        doc = fitz.open(stream=raw, filetype="pdf")
        page = doc[min(max(int(request.form.get("page") or 1) - 1, 0), len(doc) - 1)]
        zoom = min(4.0, 5000 / max(page.rect.width, page.rect.height))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        raw, mime, width, height = pix.tobytes("png"), "image/png", pix.width, pix.height
    elif not mime.startswith("image/"):
        return err("Upload a PDF, PNG or JPG.")
    width = width or int(request.form.get("width") or 0) or None
    height = height or int(request.form.get("height") or 0) or None
    loc_id = int(request.form.get("location_id") or 0) or None
    m = SiteMap(name=(request.form.get("name") or re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)).strip(),
                location_id=loc_id, data=raw, mime=mime, width=width, height=height)
    db.session.add(m)
    db.session.flush()
    log("map", f"Uploaded plan {m.name}")
    return done(id=m.id)


@bp.post("/map/from-drawing")
@auth(manage=True)
def map_from_drawing():
    d = request.get_json() or {}
    dr = db.session.get(Drawing, int(d.get("drawing_id") or 0))
    if not dr:
        return err("Pick a drawing.")
    page = int(d.get("page") or 1)
    if dr.mime == "application/pdf":
        fitz = _fitz()
        doc = fitz.open(stream=dr.data, filetype="pdf")
        p = doc[min(max(page, 1), len(doc)) - 1]
        zoom = min(4.0, 5000 / max(p.rect.width, p.rect.height))
        pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        raw, mime, w, h = pix.tobytes("png"), "image/png", pix.width, pix.height
    else:
        raw, mime = dr.data, dr.mime
        w, h = _png_dims(raw)
    loc_id = int(d.get("location_id") or 0) or None
    loc = db.session.get(Location, loc_id) if loc_id else None
    m = SiteMap(name=(d.get("name") or (f"{loc.name} plan" if loc else dr.name)).strip(), location_id=loc_id,
                data=raw, mime=mime, width=w, height=h)
    db.session.add(m)
    db.session.flush()
    log("map", f"Made plan {m.name} from {dr.name} page {page}")
    return done(id=m.id)


@bp.get("/map/<int:mid>/image")
def map_image(mid):
    m = get_or_404(SiteMap, mid)
    return Response(m.data, mimetype=m.mime, headers={"Cache-Control": "public, max-age=31536000"})


@bp.put("/map/<int:mid>")
@auth(manage=True)
def edit_map(mid):
    m = get_or_404(SiteMap, mid)
    d = request.get_json() or {}
    if d.get("name"):
        m.name = d["name"].strip()
    if "location_id" in d:
        m.location_id = d["location_id"] or None
    if d.get("width"):
        m.width, m.height = int(d["width"]), int(d["height"])
    return done()


@bp.delete("/map/<int:mid>")
@auth(manage=True)
def del_map(mid):
    m = get_or_404(SiteMap, mid)
    Area.query.filter_by(map_id=mid).delete()
    log("map", f"Removed plan {m.name}")
    db.session.delete(m)
    return done()


def _pts(raw):
    return [[round(num(x), 3), round(num(y), 3)] for x, y in raw]


@bp.post("/areas")
@auth(manage=True)
def add_area():
    d = request.get_json() or {}
    pts = _pts(d.get("points", []))
    if len(pts) not in (1,) and len(pts) < 3:
        return err("An outline needs at least 3 points.")
    a = Area(map_id=int(d["map_id"]), location_id=d.get("location_id") or None, points=pts)
    db.session.add(a)
    db.session.flush()
    return done(id=a.id)


@bp.put("/areas/<int:aid>")
@auth(manage=True)
def edit_area(aid):
    a = get_or_404(Area, aid)
    d = request.get_json() or {}
    if "location_id" in d:
        a.location_id = d["location_id"] or None
    if "points" in d:
        a.points = _pts(d["points"])
    return done()


@bp.delete("/areas/<int:aid>")
@auth(manage=True)
def del_area(aid):
    db.session.delete(get_or_404(Area, aid))
    return done()


# ── exports ────────────────────────────────────────────────────────────

def _csv(name, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    stamp = datetime.now().strftime("%Y-%m-%d")
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}-{stamp}.csv"'})


@bp.get("/export/materials.csv")
@auth()
def export_materials():
    need = compute_needs()
    rows = []
    for m in Material.query.order_by(Material.category, Material.name).all():
        n = need.get(m.id, 0)
        short = max(0, n - (m.on_hand + m.out_qty + m.on_order))
        rows.append([m.category, m.name, m.part_no, m.unit, m.on_hand, m.out_qty, m.on_order, m.installed,
                     round(n, 2), round(short, 2), m.reorder_point, m.location])
    return _csv("materials", ["Category", "Material", "Part #", "Unit", "On hand", "Out with crew", "On order",
                              "Installed", "Still needed", "Short", "Reorder at", "Location"], rows)


@bp.get("/export/order.csv")
@auth()
def export_order():
    need = compute_needs()
    rows = []
    for m in Material.query.order_by(Material.category, Material.name).all():
        n = need.get(m.id, 0)
        short = max(0, n - (m.on_hand + m.out_qty + m.on_order))
        low = max(0, (m.reorder_point or 0) - m.on_hand - m.on_order)
        q = max(short, low)
        if q > 0:
            rows.append([m.name, m.part_no, m.unit, round(q, 2), round(n, 2), m.on_hand, m.on_order,
                         "short for remaining work" if short >= low else "below reorder point"])
    return _csv("order-list", ["Material", "Part #", "Unit", "Order qty", "Still needed", "On hand", "On order",
                               "Reason"], rows)


@bp.get("/export/progress.csv")
@auth()
def export_progress():
    locations = Location.query.order_by(Location.sort, Location.id).all()
    by_id = {l.id: l for l in locations}
    ents = {(e.tracker_id, e.location_id, e.step_id): e for e in Entry.query.all()}
    rows = []
    for t in Tracker.query.order_by(Tracker.sort).all():
        labels = {s["key"]: s["label"] for s in t.status_list()}
        first = t.status_list()[0]["key"]
        fields = t.fields or []
        for l in scope_locations(t, locations, by_id):
            parent = by_id.get(l.parent_id).name if l.parent_id and by_id.get(l.parent_id) else ""
            v0 = ents.get((t.id, l.id, 0))
            for s in (t.steps if t.mode == "steps" else [None]):
                e = ents.get((t.id, l.id, s.id if s else 0))
                target = (e.target if e and e.target is not None else t.default_target) if t.mode == "qty" else ""
                rows.append([t.name, s.name if s else "", l.name, parent, l.zone,
                             labels.get(e.status if e else first, ""), e.qty if e and t.mode == "qty" else "", target,
                             ", ".join(e.crew) if e else "", e.updated_by if e else "",
                             e.updated_at.strftime("%Y-%m-%d %H:%M") if e and e.updated_at else "",
                             "; ".join(f"{f['label']}: {(v0.values or {}).get(f['key'], '')}" for f in fields) if v0 else ""])
    return _csv("progress", ["Tracker", "Step", "Location", "Inside", "Zone", "Status", "Qty", "Target", "Crew",
                             "Updated by", "Updated", "Fields"], rows)


@bp.get("/export/txns.csv")
@auth()
def export_txns():
    mats = {m.id: m for m in Material.query.all()}
    locs = {l.id: l.name for l in Location.query.all()}
    rows = []
    for t in Txn.query.order_by(Txn.at.desc()).all():
        m = mats.get(t.material_id)
        rows.append([t.at.strftime("%Y-%m-%d %H:%M"), t.kind, m.name if m else "", t.qty, m.unit if m else "",
                     t.person, locs.get(t.location_id, ""), t.note, t.by])
    return _csv("material-log", ["When (UTC)", "Type", "Material", "Qty", "Unit", "Person", "Location", "Note",
                                 "Entered by"], rows)
