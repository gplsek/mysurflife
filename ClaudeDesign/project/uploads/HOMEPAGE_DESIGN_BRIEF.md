# MySurfLife — Homepage Design Brief

**For:** Claude Design
**Purpose:** Design a compelling homepage that converts visiting surfers into users
**Tone:** Credible, technical but accessible, built by surfers for surfers — not corporate
**Audience:** Intermediate to advanced surfers who already track forecasts manually
**Created:** 2026-04-21

---

## The One Thing This Page Must Communicate

MySurfLife is not another surf forecast site. Surfline, Magic Seaweed, and Windguru
all tell you what the surf will be like. MySurfLife tells you what the surf will be
like **for you** — at your spots, on your schedule, matched to your ability and preferences.

The secret is a feedback loop no other surf app has:
- You log sessions in 30 seconds
- The app learns what conditions you actually score well in
- Over time it predicts your sessions, not just the ocean

---

## Product Overview (for content accuracy)

### What MySurfLife actually does

**Data aggregation** — pulls from NOAA buoys (real-time wave height, period, direction,
wind), WaveWatch III and GFS wave/wind models (16-day forecast), and NOAA CO-OPS tide
predictions. Sources are the same ones that professional forecasters use.

**Surf physics engine** — implements the complete Stormsurf forecasting methodology:
- Swell arrival time calculated from storm position + distance using great-circle math
- Swell decay from storm to beach using empirically-validated decay tables
- Wave face height using the industry-standard Stormsurf Swell Category system (Cat 0-10)
- Tide state, wind quality, and swell window analysis per spot

**Spot intelligence** — every spot in the database has been enriched with:
- Bathymetry data (how the seafloor shape focuses or refracts swell)
- Swell window analysis (which compass directions have unobstructed ocean fetch)
- Blocker mapping (land masses, headlands, islands that shadow certain swells)
- Break characteristics from the Wannasurf global database (9,500+ spots worldwide)

**AI Copilot** — a conversational interface powered by Claude that can:
- Answer "should I surf tomorrow?" with a personalized yes/no and explanation
- Compare two spots side by side for any forecast window
- Calculate exactly when an incoming storm's swell will hit your beach
- Explain *why* conditions will be good or bad, not just *that* they will be
- Build you a custom timeline chart for any spot and time window on request

**Session journal + personalization** — the feedback loop:
- Log a session in ~30 seconds (spot, time, duration, perceived size, rating)
- The app auto-populates actual buoy conditions from that time window (retroactively)
- Over time it learns your sweet spot at each spot: preferred swell size, period,
  direction, tide, wind
- Starts predicting session quality based on your personal history, not generic scores

**Global coverage** — spots worldwide. California and Pacific NW in detail,
expanding globally. The AI analysis works for any GPS coordinate on Earth.

---

## The Problem We're Solving (use this for hero + "How It Works" copy)

Experienced surfers don't use one source. Before any good swell, they're:

1. Tracking storms across the Pacific on satellite wind maps
2. Checking wave model forecasts to see fetch size and direction
3. Reading buoy data to confirm what's actually in the water
4. Cross-referencing tide charts for their specific spots
5. Checking wind forecasts for the morning of
6. Mentally synthesizing all of it using years of local knowledge

Then they go to Surfline to see a presentation of the same data they already looked at.

That synthesis process — the "will this swell actually work at *my* spot on *my* schedule"
calculation — lives entirely in the surfer's head. No app assists with it. No app learns
from it. No app gets better at predicting your sessions the more you use it.

MySurfLife is built to do exactly that.

---

## Key Differentiators (use these throughout the page)

**1. The Copilot doesn't just show data — it reasons about it**
Ask "Is there anything coming for next weekend?" and it runs the actual swell arrival
calculation: storm position, distance, period, decay. It tells you Saturday morning,
15-second NW energy, expect overhead at Blacks with light east winds — not "surf's up."

**2. The physics is real**
Built on validated oceanographic models, not vibes. Swell travel time uses great-circle
distances. Decay uses empirically-validated tables. Face height uses the Stormsurf
Category system (the same reference used by professional forecasters). The Copilot
explains the reasoning, so you learn, not just get an answer.

**3. Every spot knows its own behavior**
Blacks Beach in San Diego amplifies swell by 30-40% due to the La Jolla submarine canyon.
Del Mar a few miles up the coast doesn't. A generic forecast app treats them the same.
MySurfLife doesn't. Each spot's bathymetry, swell windows, and blockers are encoded
so the forecast is adjusted for where you're actually surfing.

**4. It learns your preferences over time**
A 4ft 18s NW swell means something completely different to a longboarder at Malibu
than a shortboarder at Blacks. Over time MySurfLife learns that you rate sessions
differently than the average, and adjusts its predictions accordingly. Your 8/10 is
calibrated to you, not to a crowd.

**5. You own your data**
Session logs are private by default. Your preferences, history, and predictions
belong to you — not sold to advertisers, not used to rank you against other users.

---

## Page Structure & Section Briefs

### HERO

**Headline options (pick the strongest):**
- "The surf forecast that learns how you surf."
- "Stop reading forecasts. Start predicting your sessions."
- "Your personal surf intelligence. Not just another forecast."
- "The ocean doesn't know you. MySurfLife will."

**Sub-headline:**
Real-time buoys. 16-day wave models. AI that synthesizes it all and tells you when
*your* conditions are aligning — then gets smarter every time you paddle out.

**CTA:** "Start for free" / "Join the beta"

**Hero visual ideas:**
- Animated map with buoy markers, swell propagation lines from a North Pacific storm
  tracking toward the California coast, arrival time countdown overlaid
- Clean split: left side is the Copilot chat interface ("Is there anything coming this
  weekend?"), right side is the conditions timeline rendering in real time
- Full-bleed ocean/surf photo with the three-theme UI floating above it
  (Ocean / Dawn / Daylight themes all showing the same spot, different times of day)

---

### HOW IT WORKS (3-4 steps, visual + copy)

**Step 1: Add your spots**
Tell us where you surf. We'll map the nearest buoys, pre-load the bathymetry, and
analyse the swell windows and blockers for each spot. Your spots. Your conditions.
Not a generic regional forecast.

**Step 2: Ask the Copilot anything**
"How does Wednesday morning look at Blacks?" "Compare Cardiff and Del Mar this
weekend." "Is this NW swell worth driving for?" The Copilot pulls live buoy data,
model forecasts, and tide predictions — and explains the answer in plain language,
backed by the actual physics.

**Step 3: Log your sessions in 30 seconds**
Paddle in, open the app. Tap your spot, say how long you surfed, rate it 1-10.
We auto-populate the actual conditions from that session window — buoy readings,
tide, wind — so your log is complete without you typing numbers.

**Step 4: Watch it get smarter**
After a few sessions, MySurfLife starts to know your sweet spot. It learns that you
surf Blacks well on long-period NW swells at low tide, that you prefer offshore over
glassy, and that you rate Tuesday mornings higher than weekend crowds. The Copilot
uses your history, not just the forecast, to predict your next great session.

---

### FORECAST SECTION ("The forecast that explains itself")

This section should feel like a product demo. Show the actual UI.

**Copy:**
Most forecast apps show you charts and expect you to interpret them. MySurfLife
explains what the charts mean for your session.

**Feature callouts (pair with UI screenshots/mockups):**

**Swell Arrival Tracking**
When a storm is generating swell in the North Pacific, the Copilot can tell you
exactly when the leading edge will reach your beach — down to the hour. It runs the
same calculation professional forecasters use: storm distance, swell period, travel
speed. No guessing.

**16-Day Wave + Wind + Tide Timeline**
Every spot gets a unified forecast view: wave height and period, wind speed and
direction, tide height and state — all on the same timeline. The Copilot can pull
this up for any spot, any time window, with a single question.

**Swell Category Rating**
We use the Stormsurf industry-standard Swell Category system (0-10) to express
surf size — not arbitrary "poor/fair/good" labels. A 6ft buoy reading at 14 seconds
is a Category 3 (shoulder to head high). The same 6ft at 7 seconds is Category 1
(waist to chest, probably closed out). Period matters. We show you why.

**Spot-Specific Adjustments**
Canyon spots amplify. Headlands block. Jetties refract. Your forecast is adjusted
for the specific bathymetry and geography of each spot — not just the nearest buoy.

---

### SESSION JOURNAL SECTION ("The log that makes you a better forecaster")

**Copy:**
Every session you log teaches MySurfLife something about how you surf. Over time,
your session history becomes a personal calibration dataset — connecting the conditions
that were in the water to the sessions you actually rated highly.

**Three things your session log does:**

**1. Auto-populates conditions**
You log the spot, time, and duration. We pull the actual buoy data, tide state,
and wind readings for that exact window. Your log is always complete, even if you
log it three days later.

**2. Builds your preference profile**
After a handful of sessions at any spot, we start to understand your sweet spot:
the swell size and period you surf best at, the tide you prefer, the wind you'll
paddle out in. This profile is private, yours, and gets more accurate over time.

**3. Calibrates your personal forecast**
Some surfers consistently perceive waves as bigger than the buoy reports (canyon
spots amplify). Some underestimate. Your calibration factor gets factored into
every prediction the Copilot makes for you.

---

### SPOTS SECTION ("9,500+ spots. Intelligently understood.")

**Copy:**
MySurfLife covers surf spots worldwide — from Malibu to Margaret River, Lowers to
Uluwatu. Every spot is enriched beyond a name and a GPS pin.

**What we know about each spot:**
- The buoys that best represent its offshore conditions
- Its swell window — which compass directions have unobstructed ocean access
- Its blockers — headlands, islands, reefs that shadow certain swells
- Its bathymetry — how the seafloor focuses, amplifies, or diffuses wave energy
- Its break characteristics — type, direction, tide sensitivity, hazards

**And for spots with user history:**
- How much the real surf typically differs from the buoy reading
- Which conditions consistently produce highly-rated sessions
- What your personal history says about this spot specifically

---

### AI COPILOT SECTION ("Ask it anything about the ocean")

**Copy:**
The Copilot is the interface between you and everything we know about the ocean.
It's not a chatbot — it's a surf-specific AI with access to live data, real physics,
and your personal history.

**Example queries (show these as UI chips or conversation snippets):**

- "Should I surf Blacks tomorrow morning?"
- "There's a storm at 42°N 155°W. When does it hit San Diego?"
- "Compare Cardiff and Swamis this Thursday afternoon"
- "How will conditions change at Del Mar between 6am and noon?"
- "What board should I bring on Saturday?"
- "Is this south swell going to reach Malibu or will Point Dume block it?"
- "What was my best session this month and what were the conditions?"

**Supporting copy:**
Every answer comes with an explanation — not just "conditions will be good" but
*why* they'll be good: the specific swell direction hitting the window, the tide
dropping through the ideal range, the offshore wind holding until 10am. You're
not just getting a prediction, you're learning to read the ocean.

---

### SOCIAL PROOF / CREDIBILITY SECTION

**If in beta / pre-launch:**
"Built by surfers. Grounded in real oceanography."

Call out the data sources:
- NOAA NDBC buoy network (real-time observations)
- NOAA WaveWatch III + GFS models (the same models Surfline uses)
- NOAA CO-OPS tide predictions
- Stormsurf-validated swell physics
- 9,500+ spots from the Wannasurf global database, AI-enriched

This builds credibility: the data is real, the physics is validated,
this isn't a side project with a weather API thrown on top.

---

### PRICING / CTA SECTION

**If free beta:**
"Free during beta. Your data, your predictions, forever yours."

**If freemium:**
- Free: your spots, session log, basic Copilot queries
- Pro: unlimited Copilot, swell arrival tracking, full AI analysis for all spots,
  priority alerts when your conditions align

---

### FOOTER CONTENT

- About (founder story — built because the good surfers always seemed to know
  something everyone else didn't, and it was just physics + local knowledge)
- Data sources + attribution (NOAA, WW3, CO-OPS)
- Privacy (sessions are private, no ads, no data selling)
- Beta / contact

---

## Visual + Design Direction

**Themes:** The app has three themes — Ocean (dark, deep navy/teal), Dawn (warm
orange/coral), Daylight (light, clean). The homepage should feel like the Ocean
theme — dark, dramatic, trustworthy. Show the theme switcher as a feature.

**Typography:** Geist for UI/body, Geist Mono for data/numbers (buoy readings,
forecast values, coordinates), Instrument Serif for editorial accents (section
headlines, pull quotes).

**Color language:**
- Swell conditions: blue/teal spectrum (flat → overhead)
- Wind: grey to red (glass → howling onshore)
- Tide: the tide track is teal
- Alerts / good conditions: green/gold
- Score badges: the 0-10 category scale should have a visible color ramp

**Data visualization style:**
Charts should feel like real surf data tools — clean, information-dense, not
oversimplified. The conditions timeline (wave + wind + tide) is the hero
visualization. Show it populated with real-looking data.

**Photography:**
Dawn patrol. Empty lineups. The moment before the drop. Not crowded beach
scenes, not generic stock surf. The app is for the surfer who checks the
forecast at 5am and drives an hour if it looks right.

---

## Tone of Voice Notes

**Do:** Technical but conversational. Precise. Confident. Built by someone who
actually surfs. Uses real surf vocabulary (offshore, period, DPD, swell window,
dawn patrol, set wave) without over-explaining it.

**Don't:** Corporate. Vague. "Revolutionary." "Disrupting the surf industry."
Overselling. Hiding behind buzzwords. Treating surfers like they don't
understand the ocean.

**The reader:** Has been surfing for years. Has a morning routine that involves
checking at least two forecast sources. Has driven somewhere for a swell that
didn't show up. Has also found a perfect empty session because they read it
right and nobody else did. That's who this is for.

---

## One-Sentence Pitch (for meta description, OG tags, etc.)

"MySurfLife is a personal surf intelligence platform — real-time buoys, 16-day
forecasts, and an AI Copilot that learns how you surf and predicts your sessions."

---

## Pages to Design (beyond homepage)

For reference — the full site structure:

- `/` — Homepage (this brief)
- `/forecast` — Live map + Copilot interface (the main app)
- `/spots/{slug}` — Individual spot page with conditions + timeline + AI analysis
- `/journal` — Session log
- `/about` — Founder story + data sources + mission
- `/pricing` — Tiers (if applicable)

The homepage should feel like a front door to the `/forecast` app —
the Copilot interface is the product, the homepage earns the click to try it.

---

*This brief was written with full knowledge of the product architecture,
data pipeline, physics engine, and Copilot capabilities as of April 2026.*
