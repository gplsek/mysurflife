# 🌬️ Global Wind Forecasting (Windy-style) — MySurfLife

## Goal
Build a Windy.com-style global wind forecast view for surfers:
- Visualize wind speed as color (heat) + wind direction vectors
- Support a smooth time slider + play/pause animation
- Allow panning/zooming globally and fetching only the current viewport

## Why
Surfers want to see:
- Offshore wind fields that create fetch and generate swell
- Storm development days in advance
- Local wind quality (onshore/offshore) in context

## What’s implemented so far
### Backend
- `GET /api/wind-overlay`
  - Returns wind vectors for a bounding box
  - Supports `forecast_hour` and optional `run`
  - Uses NOAA/NOMADS GFS GRIB2 subset (UGRD/VGRD @ 10m)
- `GET /api/wind/frames` (in progress)
  - Returns available forecast frames (`hours[]`) and should also return aligned `times_utc[]`
  - Must avoid NOMADS rate limiting (prefer OPeNDAP metadata discovery and caching)

### Frontend
- Wind mode toggle exists
- Wind frames caching improved (avoid repeated calls)
- Wind frame → `/api/wind-overlay` wiring confirmed working

## Time Controls (smooth slider + animation)

**Windy-style behavior**
- The time slider should advance in **hourly steps whenever the model provides hourly data**.
- When the model cadence becomes coarser farther out (e.g., 3h / 6h), the slider transparently follows that cadence.
- The user always experiences a *continuous, intuitive timeline*, even though the underlying model resolution changes.

### User requirement
- Provide a **time-based slider** that is **hourly when data is hourly**, and automatically adapts to coarser model intervals farther out.
- Support **animation** from “now” forward (play/pause, scrub).
- Prefer **fine resolution near-term** (where model cadence is denser), and gracefully degrade farther out.

### Reality of model outputs
Forecast models publish at fixed increments (commonly 1h / 3h / 6h / 12h depending on lead time and dataset). For GFS 0.25°, cadence is typically hourly near-term and coarser farther out. The UI should reflect real model timestamps rather than forcing a fixed interval.

**Option A (recommended): slider uses available frames + optional interpolation for smoothness**
- Primary: slider ticks map to **available forecast frames**.
- Optional: interpolate **u/v components** between the two nearest frames for smoother motion.
- Compute speed/direction from interpolated u/v.

**Option B (simplest MVP): slider snaps only to available frames**
- Smooth to drag, but displayed wind updates only at available frames.

### Performance note
- Request wind for the **current viewport bounds**.
- Cache the last 2–3 frames.
- Prefetch the next frame during animation.

## UI Layout requirement
- The timeline must be a **footer overlay bar** across the map (Windy-style).
- Play/Pause button on the **left**.
- Timeline/slider occupies roughly **70%** of the width.
- Right side shows current model/run/time labels.
- The right info panel should NOT contain the timeline (it becomes cramped).

### Timeline behavior (Windy-style)
- **Primary ticks are daily** (like Windy): show labels such as `Fri 12`, `Sat 13`, `Sun 14` across the timeline.
- The timeline still represents all available forecast frames; daily labels are the *major* ticks.
- As the playhead moves, show a small **floating time chip** near the playhead with the **hour of day** (e.g., `14:00`), visually distinct (e.g., highlighted color).
- **Hover behavior:** when the mouse hovers over the timeline, show a small tooltip at the hover position with the **forecast hour/time** for that position.
- **Click behavior:** clicking anywhere on the timeline jumps the selected frame (slider) to the nearest frame at that position.

## Next steps (Cursor tasks)

### Task A — Fix footer timeline rendering (currently not visible)
**Goal:** Timeline bar must render as a footer overlay across the map in Wind mode.

**Cursor checklist**
- Locate the map container element in `frontend/src/MapOverlay.js` (or the map overlay component).
- Ensure the map container has `position: relative` so an absolutely-positioned footer can anchor to it.
- Ensure the footer timeline JSX is rendered **inside** that same container (as the last child), with:
  - `position: absolute; left: 0; right: 0; bottom: 0; z-index: 1200;`
- Confirm the footer is gated by the correct state:
  - If the app uses `mode` from `App.js`, ensure the condition is `mode === 'wind'`.
  - If the app uses `overlayType`, ensure it equals `'wind'` when Global Wind view is active.
  - Avoid mismatched names (e.g., `view`, `mode`, `overlayType`) preventing rendering.
- Add `padding-bottom: 70px` (or similar) to the map container so markers/controls aren’t hidden behind the footer.

**Test**
- Switch to Global Wind mode → footer appears.
- Open devtools → verify the footer DOM exists and is not hidden by CSS.
- Temporarily set footer background to solid red to confirm visibility if needed.

### Task B — Move all wind timeline controls out of right panel
**Goal:** Right panel should not contain slider/ticks.

**Test**
- Right panel shows summary only (model, run, +Nh, vector count) and the note: “Timeline controls are in the footer.”

### Task C — Daily tick labels + playhead time chip + hover tooltip + click-to-jump
**Goal:** Windy-like timeline interaction.

**Implementation guidance**
- Build a `timesUtc[]` array (preferred) from `/api/wind/frames` and use it to compute:
  - Major tick positions for **day boundaries** (UTC or local — pick one and be consistent; Windy typically uses local display)
  - Labels like `Fri 12` using `toLocaleDateString` with `{ weekday: 'short', day: '2-digit' }`
- Render a dedicated timeline bar area (not just the `<input type="range">`), capturing mouse events:
  - `onMouseMove` → compute hovered index, show tooltip
  - `onMouseLeave` → hide tooltip
  - `onClick` → set selected frame index to nearest hovered index
- Playhead time chip:
  - Render a small label anchored above the current playhead showing local/UTC time like `14:00`

**Acceptance**
- Major tick labels show days (`Fri 12`, `Sat 13`, ...).
- Hover shows a small tooltip with hour/time at hover position.
- Clicking timeline jumps to that frame.
- Playhead displays an hour-of-day chip as it moves.

### Task D — Ensure `/api/wind/frames` returns `times_utc[]` aligned with `hours[]`
**Goal:** Frontend does not have to guess timestamps.

**Test**
- `/api/wind/frames` includes `run`, `hours[]`, and `times_utc[]` where `times_utc[i]` = `run + hours[i]`.
