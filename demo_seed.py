"""Fill a fresh tracker with a demo job so you can click around.
Usage:  python demo_seed.py http://localhost:5050      (server running, empty database)
Signs in as Tanner / PIN 1234 (Marcus and Jose use 1111)."""
import io
import json
import random
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5050").rstrip("/")
TOKEN = None


def call(method, path, body=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", ctype or "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def multipart(fields, fname, fbytes, ftype):
    bnd = "----mtdemo"
    out = b""
    for k, v in fields.items():
        out += f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    out += f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\nContent-Type: {ftype}\r\n\r\n".encode()
    out += fbytes + f"\r\n--{bnd}--\r\n".encode()
    return out, f"multipart/form-data; boundary={bnd}"


SITE_W, SITE_H = 2400, 1500


def site_plan():
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (SITE_W, SITE_H), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([60, 60, SITE_W - 60, SITE_H - 60], outline="#333", width=4)
    d.line([60, 760, SITE_W - 60, 760], fill="#999", width=18)
    d.line([1200, 60, 1200, SITE_H - 60], fill="#999", width=18)
    boxes = []
    for y0 in (120, 830):
        for c in range(8):
            x0 = 100 + c * 260 + (60 if c >= 4 else 0)
            for k in range(14):
                d.rectangle([x0, y0 + k * 42, x0 + 200, y0 + k * 42 + 26], outline="#7a8a9a", width=2)
            boxes.append((x0 - 8, y0 - 10, x0 + 208, y0 + 14 * 42))
    d.rectangle([1130, 700, 1270, 820], outline="#222", width=5)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), boxes


# PB sheet layout (PDF points, letter landscape 792x612): 6 rows, 2 transitions
ROWS = [(90, 110 + i * 70, 560, 150 + i * 70) for i in range(6)]
TRANS = [(640, 180), (640, 420)]


def ifc_set(pb_names):
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz
    doc = fitz.open()
    p = doc.new_page(width=792, height=612)
    p.insert_text((40, 40), "E-001 KEY PLAN  " + "  ".join(pb_names), fontsize=9)
    p.draw_rect(fitz.Rect(40, 60, 752, 572), color=(0, 0, 0), width=1)
    for name in pb_names:
        p = doc.new_page(width=792, height=612)
        p.insert_text((40, 40), f"E-3xx  POWER BLOCK {name}  DC STRING PLAN", fontsize=14)
        for i, (x0, y0, x1, y1) in enumerate(ROWS):
            p.draw_rect(fitz.Rect(x0, y0, x1, y1), color=(0.3, 0.3, 0.4), width=1)
            for k in range(12):
                p.draw_rect(fitz.Rect(x0 + 6 + k * 38, y0 + 6, x0 + 40 + k * 38, y1 - 6), color=(0.6, 0.6, 0.7), width=0.5)
            p.insert_text((x0 - 40, (y0 + y1) / 2 + 4), f"R{i + 1}", fontsize=10)
        for i, (x, y) in enumerate(TRANS):
            p.draw_circle(fitz.Point(x, y), 10, color=(0, 0, 0), width=1.5)
            p.insert_text((x + 16, y + 4), f"DC TRANSITION T{i + 1}", fontsize=9)
        p.draw_rect(fitz.Rect(600, 500, 760, 580), color=(0, 0, 0), width=1)
        p.insert_text((610, 525), "INVERTER SKID", fontsize=10)
    p = doc.new_page(width=792, height=612)
    p.insert_text((40, 40), "E-501 DC TRANSITION DETAIL  RISER, SEAL, LABEL", fontsize=14)
    p.draw_rect(fitz.Rect(300, 150, 500, 450), color=(0, 0, 0), width=1.5)
    return doc.tobytes()


def main():
    global TOKEN
    TOKEN = call("POST", "/api/setup", {"job_name": "Sunflower Solar Ph 2", "name": "Tanner", "pin": "1234"})["token"]
    st = call("GET", "/api/state")
    T = {t["name"]: t["id"] for t in st["types"]}
    pbs = call("POST", "/api/locations", {"type_id": T["Power block"], "pattern": "PB-{n}", "start": 1, "end": 8, "pad": 2, "zone": "North"})["ids"]
    pbs += call("POST", "/api/locations", {"type_id": T["Power block"], "pattern": "PB-{n}", "start": 9, "end": 16, "pad": 2, "zone": "South"})["ids"]
    call("POST", "/api/locations", {"type_id": T["Row"], "pattern": "{parent}-R{n}", "start": 1, "end": 6, "all_parents": True})
    call("POST", "/api/locations", {"type_id": T["Transition"], "pattern": "{parent}-T{n}", "start": 1, "end": 2, "all_parents": True})
    for n, role in (("Marcus", "lead"), ("Jose", "crew")):
        call("POST", "/api/users", {"name": n, "pin": "1111", "role": role})
    call("PUT", "/api/settings", {"crew_names": ["Dre", "Luis", "Kyle"]})
    csv = """name,part_no,category,unit,on_hand,on_order,reorder_point,location
10 AWG PV wire red,PV10-R,Wire,ft,14000,0,4000,Laydown A
10 AWG PV wire black,PV10-B,Wire,ft,9000,5000,4000,Laydown A
4/0 AL homerun,AL4/0,Wire,ft,9000,0,3000,Laydown B
MC4 connector pair,MC4-P,Connectors,ea,900,0,200,Conex 1
LBD 400A,LBD-400,Equipment,ea,10,6,0,Laydown C
2in PVC riser,PVC-2R,Conduit,ea,20,0,10,Laydown B
Duct seal,DS-1,Conduit,lb,12,0,5,Conex 2
Ground lug,GL-1,Grounding,ea,140,0,150,Conex 2
Wire tags,TAG-1,Labels,box,4,0,2,Conex 1"""
    call("POST", "/api/materials/import", {"csv": csv})
    M = {m["name"]: m["id"] for m in call("GET", "/api/state")["materials"]}

    t_str = call("POST", "/api/trackers", {"name": "DC string wiring", "type_id": T["Row"], "mode": "steps", "color": "#E5484D", "due_date": "2026-12-12",
        "steps": [{"name": "Pull wire"}, {"name": "Terminate"}, {"name": "Megger"}, {"name": "Label"}],
        "fields": [{"label": "Megger (MΩ)", "type": "number"}],
        "materials": [{"material_id": M["10 AWG PV wire red"], "step_index": 0, "qty": 180}, {"material_id": M["10 AWG PV wire black"], "step_index": 0, "qty": 180},
                      {"material_id": M["MC4 connector pair"], "step_index": 1, "qty": 12}, {"material_id": M["Wire tags"], "step_index": 3, "qty": 0.05}]})["id"]
    t_tr = call("POST", "/api/trackers", {"name": "DC transitions", "type_id": T["Transition"], "mode": "steps", "color": "#5CC8FF",
        "steps": [{"name": "Riser set"}, {"name": "Cable pulled"}, {"name": "Terminated"}, {"name": "Sealed"}],
        "materials": [{"material_id": M["2in PVC riser"], "step_index": 0, "qty": 1}, {"material_id": M["Duct seal"], "step_index": 3, "qty": 0.5}]})["id"]
    t_lbd = call("POST", "/api/trackers", {"name": "LBD", "type_id": T["Power block"], "mode": "steps", "color": "#FFB224",
        "steps": [{"name": n} for n in ("Stuff", "Term", "Stickers", "Ground / brackets", "Quality check", "Quality docs")],
        "materials": [{"material_id": M["LBD 400A"], "step_index": 0, "qty": 1}, {"material_id": M["Ground lug"], "step_index": 3, "qty": 8}]})["id"]
    t_ft = call("POST", "/api/trackers", {"name": "Homerun pull", "type_id": T["Power block"], "mode": "qty", "unit": "ft", "default_target": 1200, "color": "#B07CFF",
        "materials": [{"material_id": M["4/0 AL homerun"], "qty": 1}]})["id"]
    call("POST", "/api/trackers", {"name": "Inspection", "type_id": T["Power block"], "mode": "status", "color": "#2DD4BF", "show_map": True,
        "statuses": [{"label": "Not inspected", "color": "#3B4B68"}, {"label": "Ready", "color": "#5CC8FF"}, {"label": "Passed", "color": "#36D399", "done": True}, {"label": "Failed", "color": "#FF5D4A", "problem": True}]})
    st = call("GET", "/api/state")
    tr = {t["id"]: t for t in st["trackers"]}
    locs = st["locations"]
    rows_by_pb = {}
    for l in locs:
        if l["type_id"] == T["Row"]:
            rows_by_pb.setdefault(l["parent_id"], []).append(l["id"])
    trans_by_pb = {}
    for l in locs:
        if l["type_id"] == T["Transition"]:
            trans_by_pb.setdefault(l["parent_id"], []).append(l["id"])
    random.seed(7)
    crews = [["Jose", "Dre"], ["Luis"], ["Kyle", "Marcus"]]
    steps = [s["id"] for s in tr[t_str]["steps"]]
    for i, pb in enumerate(pbs):
        rows = rows_by_pb[pb]
        for j, sid in enumerate(steps):
            n_done = max(0, min(6, 6 - (i - (9 - j * 3)) )) if i >= 9 - j * 3 else 6
            n_done = 6 if i < 9 - j * 3 else max(0, 6 - (i - (9 - j * 3)) * 2)
            if n_done:
                call("POST", "/api/entries", {"tracker_id": t_str, "location_ids": rows[:n_done], "step_ids": [sid], "status": "done", "crew": random.choice(crews)})
            if n_done < 6 and (i + j) % 3 == 0:
                call("POST", "/api/entries", {"tracker_id": t_str, "location_ids": [rows[n_done]], "step_ids": [sid], "status": "doing", "crew": random.choice(crews)})
        tsteps = [s["id"] for s in tr[t_tr]["steps"]]
        for j, sid in enumerate(tsteps):
            if i < 10 - j * 2:
                call("POST", "/api/entries", {"tracker_id": t_tr, "location_ids": trans_by_pb[pb], "step_ids": [sid], "status": "done", "crew": ["Luis"]})
        lsteps = [s["id"] for s in tr[t_lbd]["steps"]]
        for j, sid in enumerate(lsteps):
            if i < 8 - j:
                call("POST", "/api/entries", {"tracker_id": t_lbd, "location_ids": [pb], "step_ids": [sid], "status": "done", "crew": ["Kyle"]})
        if i < 11:
            call("POST", "/api/entries", {"tracker_id": t_ft, "location_ids": [pb], "qty": 1200 if i < 7 else 400 + i * 30, "crew": ["Marcus"]})
    call("POST", "/api/entries", {"tracker_id": t_str, "location_ids": [rows_by_pb[pbs[4]][2]], "step_ids": [steps[2]], "status": "blocked", "note": "Low megger on string 3"})
    call("POST", "/api/entries", {"tracker_id": t_str, "location_ids": rows_by_pb[pbs[0]][:6], "values": {"megger_m": "550"}})
    call("POST", "/api/txns", {"material_id": M["10 AWG PV wire red"], "kind": "grab", "qty": 2200, "person": "Jose", "location_id": pbs[12]})
    call("POST", "/api/txns", {"material_id": M["MC4 connector pair"], "kind": "grab", "qty": 120, "person": "Dre"})
    call("POST", "/api/txns", {"material_id": M["LBD 400A"], "kind": "order", "qty": 4, "expected": "2026-11-20"})

    # site plan + PB outlines
    png, boxes = site_plan()
    body, ct = multipart({"width": SITE_W, "height": SITE_H, "name": "Site plan E-001"}, "site.png", png, "image/png")
    site_id = call("POST", "/api/map", raw=body, ctype=ct)["id"]
    for pb, (x0, y0, x1, y1) in zip(pbs, boxes):
        call("POST", "/api/areas", {"map_id": site_id, "location_id": pb, "points": [[x0 / SITE_W * 100, y0 / SITE_H * 100], [x1 / SITE_W * 100, y0 / SITE_H * 100], [x1 / SITE_W * 100, y1 / SITE_H * 100], [x0 / SITE_W * 100, y1 / SITE_H * 100]]})

    # IFC set with one sheet per PB, auto-matched
    names = [l["name"] for l in locs if l["type_id"] == T["Power block"]]
    pdf = ifc_set(names)
    body, ct = multipart({"sheet": "E-300", "rev": "IFC", "name": "DC string plans", "auto_type_id": T["Power block"]}, "IFC DC set.pdf", pdf, "application/pdf")
    r = call("POST", "/api/drawings", raw=body, ctype=ct)
    dwg = r["id"]
    detail_page = len(names) + 2
    call("POST", "/api/drawing-links", {"drawing_id": dwg, "page": detail_page, "tracker_id": t_tr, "label": "Transition detail"})
    call("POST", "/api/drawing-links", {"drawing_id": dwg, "page": 1, "tracker_id": t_str, "label": "Key plan"})

    # PB-01 and PB-02 plans made from their sheets, rows outlined, transitions pinned
    for k in (0, 1):
        pb = pbs[k]
        page = 2 + k
        m_id = call("POST", "/api/map/from-drawing", {"drawing_id": dwg, "page": page, "location_id": pb})["id"]
        for rid, (x0, y0, x1, y1) in zip(rows_by_pb[pb], ROWS):
            call("POST", "/api/areas", {"map_id": m_id, "location_id": rid, "points": [[x0 / 7.92, y0 / 6.12], [x1 / 7.92, y0 / 6.12], [x1 / 7.92, y1 / 6.12], [x0 / 7.92, y1 / 6.12]]})
        for tid, (x, y) in zip(trans_by_pb[pb], TRANS):
            call("POST", "/api/areas", {"map_id": m_id, "location_id": tid, "points": [[x / 7.92, y / 6.12]]})
    print(f"Demo job ready ({r.get('linked', 0)} IFC pages matched). Sign in as Tanner, PIN 1234.")


if __name__ == "__main__":
    main()
