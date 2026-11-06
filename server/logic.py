"""Material movement rules, tracker scope and need math. Mirrored in web/app.js."""
import math
from collections import defaultdict

from .models import Entry, Location, Material, Tracker, Txn, db

KINDS = ("receive", "grab", "return", "used", "order", "count", "scrap")


def apply_txn(m: Material, t: Txn, sign: int = 1):
    """Apply (sign=1) or reverse (sign=-1) a movement on a material's counters."""
    q = (t.qty or 0) * sign
    k = t.kind
    if k == "receive":
        m.on_hand += q
        if t.source == "order":
            m.on_order = max(0.0, m.on_order - q)
    elif k == "grab":
        m.on_hand -= q
        m.out_qty += q
    elif k == "return":
        m.out_qty -= q
        m.on_hand += q
    elif k == "used":
        if t.source == "stock":
            m.on_hand -= q
        else:
            m.out_qty -= q
        m.installed += q
    elif k == "order":
        m.on_order += q
    elif k in ("scrap",):
        m.on_hand -= q
    elif k == "count":  # qty holds the delta
        m.on_hand += q
    m.out_qty = max(0.0, round(m.out_qty, 4))
    m.on_order = max(0.0, round(m.on_order, 4))
    m.on_hand = round(m.on_hand, 4)
    m.installed = round(m.installed, 4)


def descendants_map(locations):
    kids = defaultdict(list)
    for l in locations:
        if l.parent_id:
            kids[l.parent_id].append(l.id)
    return kids


def ancestors(loc_id, by_id):
    out, seen = [], set()
    cur = by_id.get(loc_id)
    while cur and cur.parent_id and cur.parent_id not in seen:
        seen.add(cur.parent_id)
        out.append(cur.parent_id)
        cur = by_id.get(cur.parent_id)
    return out


def scope_locations(tracker, locations, by_id=None):
    """Locations of the tracker's type that fall inside its scope."""
    by_id = by_id or {l.id: l for l in locations}
    sc = tracker.scope or {}
    mode = sc.get("mode", "all")
    ids, zones = set(sc.get("ids") or []), set(sc.get("zones") or [])
    out = []
    for l in locations:
        if l.type_id != tracker.type_id:
            continue
        if mode == "pick" and l.id not in ids:
            continue
        if mode == "parents" and not ids.intersection(ancestors(l.id, by_id)):
            continue
        if mode == "zones" and (l.zone or "") not in zones:
            # rows inherit their PB's zone when they have none
            z = l.zone or next((by_id[a].zone for a in ancestors(l.id, by_id) if by_id.get(a) and by_id[a].zone), "")
            if z not in zones:
                continue
        out.append(l)
    return out


LENGTH_UNITS = {"ft", "lf", "m", "'", "in", "yd"}


def field_count(t, e0, key):
    """Value of a number field on a location (e.g. LBD runs), falling back to the field's default."""
    f = next((f for f in (t.fields or []) if f.get("key") == key), None)
    raw = (e0.values or {}).get(key) if e0 else None
    if raw in (None, ""):
        raw = (f or {}).get("default", 0)
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return 0.0


def target_of(t, e0):
    return ((e0.target if e0 and e0.target is not None else t.default_target) or 0)


def kit_total(t, tm, e0, unit="ea"):
    """How much of one kit line a single location takes, spare included."""
    per = tm.per or "each"
    if per == "unit":
        base = target_of(t, e0)
    elif per.startswith("f:"):
        base = field_count(t, e0, per[2:])
    else:
        base = 1.0
    q = (tm.qty or 0) * base * (1 + (tm.extra_pct or 0) / 100.0)
    return round(q, 3) if (unit or "").lower() in LENGTH_UNITS else float(math.ceil(q - 1e-9))


def kit_progress(t, tm, ents, lid, step_ids, done_keys):
    """Fraction of one kit line already installed at a location (0..1)."""
    def is_done(sid):
        e = ents.get((lid, sid))
        return bool(e and e.status in done_keys)
    if t.mode == "qty":
        e0 = ents.get((lid, 0))
        tg = target_of(t, e0)
        if (tm.per or "each") == "unit":
            return min(1.0, (e0.qty or 0) / tg) if e0 and tg else (1.0 if is_done(0) else 0.0)
        return 1.0 if is_done(0) else 0.0
    if t.mode == "status":
        return 1.0 if is_done(0) else 0.0
    if tm.step_id:
        return 1.0 if is_done(tm.step_id) else 0.0
    return 1.0 if step_ids and all(is_done(s) for s in step_ids) else 0.0


def sync_kits(t, loc_ids, by_name):
    """Make the automatic kit movements for these locations match their claim and done state.
    Claimed → kit is out with the claimer. Done → kit is installed. Unclaimed → kit goes back.
    Idempotent: running it again changes nothing. Returns [(material, kind, qty, person)] it posted."""
    mode = t.kit_mode or "claim"
    if mode == "off" or not t.materials or not loc_ids:
        return []
    loc_ids = list(loc_ids)
    ents = {(e.location_id, e.step_id): e for e in
            Entry.query.filter(Entry.tracker_id == t.id, Entry.location_id.in_(loc_ids)).all()}
    txns = defaultdict(list)
    for x in Txn.query.filter(Txn.tracker_id == t.id, Txn.auto == "kit", Txn.location_id.in_(loc_ids)).order_by(Txn.id).all():
        txns[(x.location_id, x.material_id, x.step_id or 0)].append(x)
    mats = {m.id: m for m in Material.query.filter(Material.id.in_([tm.material_id for tm in t.materials])).all()}
    done_keys, step_ids = t.done_keys(), [s.id for s in t.steps]
    moved = []

    def post(m, kind, qty, person, lid, sid, source=""):
        qty = round(qty, 3)
        if qty <= 0.0005:
            return
        tx = Txn(material_id=m.id, kind=kind, qty=qty, source=source, person=person or "", location_id=lid,
                 tracker_id=t.id, auto="kit", step_id=sid, note=f"Kit · {t.name}", by=by_name)
        apply_txn(m, tx)
        db.session.add(tx)
        txns[(lid, m.id, sid)].append(tx)
        moved.append((m, kind, qty, person or ""))

    for lid in loc_ids:
        e0 = ents.get((lid, 0))
        crew = [c for c in ((e0.crew if e0 else None) or []) if c] if t.claims else []
        claimer = crew[0] if crew else ""
        want = defaultdict(lambda: [0.0, 0.0])  # (mat, step) -> [total, installed]
        for tm in t.materials:
            m = mats.get(tm.material_id)
            if not m:
                continue
            total = kit_total(t, tm, e0, m.unit)
            used = total * kit_progress(t, tm, ents, lid, step_ids, done_keys)
            if m.unit and m.unit.lower() not in LENGTH_UNITS:
                used = float(math.floor(used + 1e-9)) if used < total else total
            w = want[(m.id, tm.step_id or 0)]
            w[0] += total
            w[1] += used
        # lines removed from the kit since: put their open movements back to zero too
        for (l2, mid, sid) in list(txns):
            if l2 == lid and (mid, sid) not in want and mid in mats:
                want[(mid, sid)] = [0.0, 0.0]
        for (mid, sid), (total, want_used) in want.items():
            m = mats[mid]
            hist = txns[(lid, mid, sid)]
            holders = defaultdict(float)
            used = 0.0
            for x in hist:
                if x.kind == "grab":
                    holders[x.person] += x.qty
                elif x.kind == "return":
                    holders[x.person] -= x.qty
                elif x.kind == "used":
                    used += x.qty
                    if x.source != "stock":
                        holders[x.person] -= x.qty
            # 1. installed
            if want_used > used + 0.0005:
                need = want_used - used
                for person in sorted(holders, key=lambda p: p != claimer):
                    take = min(need, max(0.0, holders[person]))
                    if take > 0.0005:
                        post(m, "used", take, person, lid, sid)
                        holders[person] -= take
                        need -= take
                if need > 0.0005:
                    post(m, "used", need, claimer or by_name, lid, sid, source="stock")
            elif used > want_used + 0.0005:  # un-done: take back the automatic install entries, newest first
                extra = used - want_used
                for x in reversed([x for x in hist if x.kind == "used"]):
                    if extra <= 0.0005:
                        break
                    r = min(x.qty, extra)
                    moved.append((m, "unused", r, x.person))
                    apply_txn(m, x, -1)
                    if x.source != "stock":
                        holders[x.person] += r
                    x.qty = round(x.qty - r, 3)
                    if x.qty > 0.0005:
                        apply_txn(m, x, 1)
                    else:
                        hist.remove(x)
                        db.session.delete(x)
                    extra -= r
            # 2. what's still out, and with whom
            want_out = max(0.0, total - want_used) if (mode == "claim" and claimer) else 0.0
            target = {claimer: want_out} if claimer else {}
            for person in list(holders):
                excess = holders[person] - target.get(person, 0.0)
                if excess > 0.0005:
                    post(m, "return", excess, person, lid, sid)
                    holders[person] -= excess
            for person, q in target.items():
                short = q - max(0.0, holders.get(person, 0.0))
                if short > 0.0005:
                    post(m, "grab", short, person, lid, sid)
    return moved


def compute_needs():
    """{material_id: qty still needed for remaining work}"""
    locations = Location.query.all()
    by_id = {l.id: l for l in locations}
    entries = defaultdict(dict)  # tracker_id -> {(loc, step): Entry}
    for e in Entry.query.all():
        entries[e.tracker_id][(e.location_id, e.step_id)] = e
    need = defaultdict(float)
    mats = {m.id: m for m in Material.query.all()}
    for t in Tracker.query.all():
        if t.status == "done" or not t.materials:
            continue
        done = t.done_keys()
        ents = entries[t.id]
        locs = [l.id for l in scope_locations(t, locations, by_id)]
        step_ids = [s.id for s in t.steps]

        for tm in t.materials:
            m = mats.get(tm.material_id)
            if not m:
                continue
            for lid in locs:
                left = 1.0 - kit_progress(t, tm, ents, lid, step_ids, done)
                if left > 0:
                    need[tm.material_id] += kit_total(t, tm, ents.get((lid, 0)), m.unit) * left
    for m in mats.values():
        need[m.id] += m.extra_need or 0
    return need


def out_by_person():
    out = defaultdict(lambda: defaultdict(float))
    for t in Txn.query.filter(Txn.kind.in_(("grab", "return", "used"))).all():
        if not t.person:
            continue
        if t.kind == "grab":
            out[t.person][t.material_id] += t.qty
        elif t.kind == "return" or (t.kind == "used" and t.source != "stock"):
            out[t.person][t.material_id] -= t.qty
    clean = {}
    for person, mats in out.items():
        kept = {mid: round(q, 3) for mid, q in mats.items() if q > 0.0001}
        if kept:
            clean[person] = kept
    return clean
