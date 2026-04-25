# Profile drawer — implementation spec

File: `mysurflife-profile.html`

A right-side slide-in drawer opened from the avatar button in the topbar. Matches the `SpotDetailPanel` pattern (backdrop-blur panel, identical token usage). On mobile (≤600px) it becomes a bottom sheet with a grabber handle.

---

## Entry point

The topbar exposes an `avatar-btn` (40×40, rounded 10px) at the far right. Clicking it toggles the drawer. Keep this as the single entry point across the app — do not scatter profile-related affordances elsewhere.

---

## States

The prototype exposes a state switcher in the bottom-left (prototype-only; remove in production). The underlying state is stored on `<body data-mode="…">`. Keyboard: number keys jump between named states, `Esc` closes (or backs out of an overlay sheet first).

| mode | trigger | what changes |
|---|---|---|
| `view` | default / after save | Read-only identity block; `Edit` button visible in header |
| `edit` | click `Edit` | Identity fields become inputs; `Cancel` + `Save` replace `Edit`; avatar gains "+" upload affordance; per-row edit icons on Quiver / My Spots are always shown |
| `upload` | click avatar "+" in edit | Overlay sheet inside the drawer: drop-zone + progress bar; completes → `dirty` |
| `dirty` | any edit-field `input` event | Yellow "unsaved changes" banner appears below the header; `Save` remains primary |
| `saved` | click `Save` | Green toast bottom-center for 2.6s, then auto-returns to `view` |
| `error` | server returns "email in use" | `#field-email` gets red border + inline error message |
| `signout` | click `Sign out` in footer | Center modal with `Stay signed in` / `Sign out` buttons |
| `pindrop` | click "Drop a pin on the map" in My Spots | Full-drawer overlay sheet: mini-map with draggable pin + metadata form |
| `addboard` | click "Add a board" in Quiver | Overlay sheet inside the drawer: form for board name / shape / dimensions / primary flag |
| `closed` | Esc / scrim click / close icon | Drawer translates off-screen, scrim fades |

---

## Sections (top to bottom)

1. **Identity** — avatar (64×64, gradient monogram + upload affordance in edit), name, handle, home-break chip. Edit mode replaces the read-only block with 4 form fields (name / handle / email / home-break select).
2. **2026 Year in Surf** — 2×3 stats grid: sessions, waves, water time, longest, 30-day streak with dot-chart, favorite spot. Skill pill in the section header.
3. **Quiver** — list of boards with primary-driver dot indicator, dimensions in mono, per-row edit icon (appears on hover, always in edit mode), dashed "Add a board" CTA → `addboard` sheet.
4. **My Spots · N private** — user-created spots, only visible to this user. Each row shows a pin tile (with a small fire-colored dot to distinguish from public spots), spot name, a `Private` lock chip, mono lat/lon, and break type. Per-row "open" and "edit" icon buttons (hover/edit-mode reveal). Dashed "Drop a pin on the map" CTA launches the **pin-drop sheet** (see below).
5. **Preferences** — units segment, theme segment, forecast cadence segment, haptics toggle.
6. **Alerts · N spots** — rating-color dot, spot name, rule in mono, per-row on/off toggle.
7. **Connected accounts** — *Coming soon.* Placeholder card with lock icon, one-line description ("Sync sessions from Apple Health, Strava, and Surfline"), and a disabled `Notify me` button. No provider logos rendered yet.
8. **Plan & Billing** — *Coming soon.* Stubbed gradient card (aqua→fire tint) showing current plan as "Free · Early access" with a disabled `Manage plan` button. No renew date, no invoice history.
9. **Data & privacy** — export (.zip) and delete account, with `Delete` styled as a danger button.
10. **Footer (sticky)** — "Signed in as …" + `Sign out`.

---

## Pin-drop sheet (add private spot)

Full-drawer overlay; slides in from the right over the drawer content. Dismissed via the back chevron (returns to drawer scroll position unchanged) or Save (closes sheet + fires `saved` toast).

**Layout**

- **Header** — back chevron, title "Drop a pin", `Save` primary button (disabled until name + lat/lon are valid).
- **Mini-map** — 180px tall, full-width, rounded 12px. In the prototype this is a stylized SVG placeholder; in production it's a real slippy map (see wiring below). Contains:
  - A draggable pin centered on current position. Dragging OR tapping anywhere on the map moves the pin and writes the new lat/lon back to the form fields.
  - A small crosshair/"recenter on me" icon button (top-right of the map).
  - Attribution line in the bottom-right (Mapbox/CARTO terms).
- **Form fields** (vertical stack, label above input):
  - `Name` (text, required) — e.g. "Secret reef"
  - `Latitude` / `Longitude` (2-column, mono, required) — bidirectional with the pin: editing the field moves the pin, dragging the pin updates the field. Validate to 6 decimal places.
  - `Break type` (segmented: Reef / Point / Beach / Rivermouth / Slab)
  - `Wave direction` (segmented: Left / Right / Both / A-frame)
  - `Best swell` (compass picker: 16-point cardinal → stored as degrees + cardinal string)
  - `Best tide` (segmented: Low / Mid / High / All) + `Best wind` (segmented: Offshore / Cross / Onshore / Glass)
  - `Hazards` (multi-select chips: Shallow / Rocks / Urchins / Sharks / Crowds / Current / Localism / Boats)
  - `Notes` (textarea, 4 rows) — free-form

**Save behavior**

- Fires `saved` toast, closes the sheet, scrolls the drawer so the new spot is visible in the My Spots list.
- Persists to a per-user `private_spots` table (schema below).
- Private spots are **never** exposed in global search, public feeds, or another user's map. The forecast pipeline treats them identically to public spots — same swell/wind/tide model, same rating formula — just scoped to the owner.

**Schema**

```
private_spots (
  id            uuid pk,
  user_id       uuid fk → users.id,
  name          text not null,
  lat           numeric(9,6) not null,
  lon           numeric(9,6) not null,
  break_type    enum('reef','point','beach','rivermouth','slab'),
  wave_dir      enum('left','right','both','a-frame'),
  best_swell_deg    smallint,
  best_swell_cardinal text,        -- 'NW', 'WNW', etc.
  tide_window   enum('low','mid','high','all'),
  wind_pref     enum('offshore','cross','onshore','glass'),
  hazards       text[],
  notes         text,
  created_at    timestamptz default now()
)
-- RLS: SELECT/INSERT/UPDATE/DELETE only where user_id = auth.uid()
```

---

## Avatar upload flow

`upload` state renders a sheet **inside the drawer** (not full-screen) to keep the user in context. Production wiring:
- Accept PNG/JPG ≤ 4MB; square crop preferred.
- On drop/pick, show filename + size in progress sub.
- On complete, close sheet and transition to `dirty` (user still needs to hit Save to persist).

---

## Validation

Email-in-use is the canonical example. Render inline error (`.field.err`) with red border + icon + message. Don't block form — user should be able to fix and re-submit.

Pin-drop form: disable `Save` until name is non-empty and lat ∈ [−90, 90], lon ∈ [−180, 180]. Show inline error on lat/lon if out of range.

---

## Mobile (≤600px)

- Drawer slides up from the **bottom** (92vh height, 16px top radius).
- Grabber handle at the top (36×4 pill).
- Pin-drop and upload sheets remain full-drawer overlays (they already fit the mobile drawer).
- State switcher wraps to multiple lines, horizontally scrollable.
- Otherwise all content reflows naturally.

---

## Production wiring (replace stand-ins)

- **Stats** are hardcoded. Wire to the sessions table (same source the session-log page reads).
- **Quiver** is hardcoded. Add CRUD (create/edit/delete board, mark primary) via the `addboard` sheet.
- **My Spots** are hardcoded. Persist to the `private_spots` schema above. Owner-only RLS.
- **Pin-drop mini-map** in the prototype is a stylized SVG placeholder. In production, embed a real Leaflet/Mapbox map centered on the user's current geolocation (fallback: home-break coords, then map center). Satellite tiles preferred. Inputs for lat/lon stay bidirectional with the pin position.
- **Alerts** rows share the rule-authoring UI with the alerts page; reuse the same component.
- **Connected accounts** — currently a "Coming soon" stub. When built: OAuth to Apple Health, Strava, Surfline. Row layout reserved: colored logo tile + provider name + `Connect` / `Disconnect` button. Capture waitlist emails from the `Notify me` button in the interim.
- **Plan & Billing** — currently a "Coming soon" stub. When built: Stripe Customer Portal for `Manage plan` (self-serve cancel / update card / download invoices), plan name + renew date pulled from the subscription object, plus in-app invoice history if we don't want to bounce users to Stripe.
- **Sign-out confirm** must actually invalidate the session and route to `mysurflife.html`.
- **Delete account** should trigger a second confirmation (type-the-email pattern) — not built in the prototype.
- Remove the `.state-switcher` element before shipping.
