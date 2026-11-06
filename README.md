# Material Tracker

Tracks materials, crew progress and drawings for a solar electrical job. It runs as a website, an installable phone app (home-screen PWA that keeps working with no signal), and a Windows .exe.

## How it's organized

**Location types** are the things work is tracked against. You define them yourself. New jobs start with:
- **Power block** (outlined on the site plan)
- **Row**, inside a power block
- **Transition**, inside a power block. These are shown as **pins**, for the points where cable comes up.

You can add more, like Inverter, Combiner or Trench segment. Each type can live inside another one.

**Locations** are the actual PB-01, PB-01-R3, PB-01-T2 and so on. To create them, use a numbered pattern like `{parent}-R{n}` and the app generates rows 1–6 under every PB at once. You can also type the names out.

**Trackers** are what you follow across those locations. Each tracker has:
- **Tracked by**: which location type it runs against (rows, PBs, transitions…)
- **How it's tracked**:
  - **Steps**: ordered steps, each with its own status (pull → terminate → megger → label)
  - **One status**: one status per location (an inspection, for example)
  - **Quantity**: counts against a target (feet pulled, strings landed)
- **Statuses**: your own names and colors. You mark which ones count as done and which ones are a problem.
- **Extra fields**: text, number, date, checkbox or pick list, recorded on each location (megger reading, date landed…)
- **Scope**: all locations, only those inside certain PBs, by zone, or hand-picked
- **Material per location** (or per unit): this feeds "still need" and the order list. You can also have material logged as installed automatically when something is marked done.
- **Drawings** attached to the tracker
- Presets to start from: DC strings by row, Transitions, PB terminations (LBD style), Cable footage, Inspection, or blank

## Drawings (IFC)
- Upload IFC sets and PB sheets as PDF or image.
- **Match pages** reads the text on each page and links it to the PB named there. Key plans that mention lots of PBs are skipped. Scanned PDFs have no text to read, so link those by hand.
- Link any page to locations and/or a tracker.
- Tapping a location shows its own drawings, its parent's drawings (a row shows its PB's sheets), and the drawings of every tracker that covers it. They open in a full-screen viewer with pan and zoom, a night or original color toggle, and tabs for the related sheets.
- **Use as plan** turns a page into a map. A PB sheet becomes that PB's plan, where you outline rows and pin transitions.
- Sheets you've already opened stay available offline.

## Maps
- One site plan plus a plan for any location (PB plans). Tapping a PB opens its panel with an **Open PB plan** button. The breadcrumb takes you back.
- Outline tools: **Box**, **Outline** (tap corners), **Pin**, **Pick** (reassign or remove). "Next in order" assigns each shape to the next unplaced location automatically.
- The map colors by any tracker or a single step. A PB rolls up the status of the rows inside it.
- A drawing-sheet grid (A–H, 1–n) gives every location a grid reference.

## Materials
On hand, out with the crew, on order, still needed and short, with a stock gauge for each item. Movements are grab, used/installed, return, received, order and count. Every person's checked-out material is tracked. You can import from CSV, and the order list exports to CSV.

## Roles
- **Crew**: log material and update progress
- **Lead**: also manages materials, trackers, plans and drawings
- **Foreman**: everything, including roles

## Run it
```bash
pip install -r requirements.txt
python run.py                      # http://localhost:5050
python demo_seed.py                # optional demo job (Tanner / 1234)
```

## Railway
1. Create a Railway project from this repo and add **PostgreSQL**. `DATABASE_URL` is set for you.
2. Set `SECRET_KEY` to any long random string. It keeps people signed in across redeploys.
3. Deploy, open the URL, and set up the job. Plans and drawings are stored in the database.

## Phones
Open the site. On iPhone use **Share → Add to Home Screen**. On Android use **menu → Install app**.

## Windows .exe
GitHub Actions builds it on every `v*` tag, or you can run **Actions → Build Windows app** by hand. Unzip it and set `server_url` in `config.ini` to your Railway URL so it shares data with the phones. Leave it blank to keep a private copy on that PC.

## Layout
```
server/   Flask API: models.py, api.py, logic.py (movement rules, scope, need math)
web/      app.js, styles.css, service worker, manifest, fonts, icons
desktop/  pywebview launcher + PyInstaller spec
```
