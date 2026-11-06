"""Material movement rules, tracker scope and need math. Mirrored in web/app.js."""
from collections import defaultdict

from .models import Entry, Location, Material, Tracker, Txn

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


def compute_needs():
    """{material_id: qty still needed for remaining work}"""
    locations = Location.query.all()
    by_id = {l.id: l for l in locations}
    entries = defaultdict(dict)  # tracker_id -> {(loc, step): Entry}
    for e in Entry.query.all():
        entries[e.tracker_id][(e.location_id, e.step_id)] = e
    need = defaultdict(float)
    for t in Tracker.query.all():
        if t.status == "done" or not t.materials:
            continue
        done = t.done_keys()
        ents = entries[t.id]
        locs = [l.id for l in scope_locations(t, locations, by_id)]
        step_ids = [s.id for s in t.steps]

        def is_done(lid, sid):
            e = ents.get((lid, sid))
            return bool(e and e.status in done)

        for tm in t.materials:
            if t.mode == "qty":
                remaining = 0.0
                for lid in locs:
                    e = ents.get((lid, 0))
                    target = (e.target if e and e.target is not None else t.default_target) or 0
                    remaining += max(0.0, target - (e.qty if e else 0))
                need[tm.material_id] += remaining * (tm.qty or 0)
            elif t.mode == "status":
                need[tm.material_id] += sum(1 for lid in locs if not is_done(lid, 0)) * (tm.qty or 0)
            else:
                if tm.step_id:
                    rem = sum(1 for lid in locs if not is_done(lid, tm.step_id))
                else:
                    rem = sum(1 for lid in locs if not step_ids or any(not is_done(lid, s) for s in step_ids))
                need[tm.material_id] += rem * (tm.qty or 0)
    for m in Material.query.all():
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
