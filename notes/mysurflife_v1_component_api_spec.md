# mysurflife v1 Component + API Spec

## Purpose
This document turns the Copilot-first mysurflife concept into a concrete v1 product spec covering:
- frontend screens
- Copilot UI components
- visualization/artifact components
- backend APIs and tool endpoints
- session report schema
- personalized score inputs
- what to keep, simplify, or remove from the current product direction

This is intentionally practical and aimed at helping decide what to build first with the current mysurflife codebase.

---

# 1. v1 Product Goal

Build a **Copilot-assisted surf decision app** that helps a user answer questions like:
- "Should I surf in 2 hours?"
- "How windy will it be at 3pm at Cardiff?"
- "Compare Del Mar and Seaside this afternoon"
- "What board should I bring?"
- "Log my session from this morning"

The app should:
1. aggregate surf-relevant data
2. normalize it into a stable model
3. support direct Q&A through Copilot
4. render evidence inside responses
5. capture session feedback to improve personalization

---

# 2. v1 Product Boundaries

## In scope
- spot lookup
- current and near-future conditions
- tide and wind timelines
- buoy trend access
- spot comparison
- basic personalized score
- board/equipment recommendation
- conversational session logging
- session history basics
- inline charts/tables/cards in Copilot

## Out of scope for v1
- advanced public social feed
- full community/session sharing
- heavy map overlays
- advanced machine-learning ranking
- complex push notification system
- photo/video-heavy session journaling
- full route/travel planner
- overly complex dashboard pages

---

# 3. Recommended v1 UX Structure

The app should have a **lightweight product shell** with Copilot as the main intent interface.

## Primary screens
1. Home
2. Spot Detail
3. Copilot
4. Session Log / Session History
5. Preferences / Profile

## Navigation recommendation
Top-level nav could be as simple as:
- Home
- Spots
- Copilot
- Sessions
- Profile

On mobile, Copilot can be a main tab.
On desktop, Copilot can be a right-side panel or a dedicated page.

---

# 4. Frontend Screen Spec

## 4.1 Home Screen

### Purpose
Give the user:
- a fast snapshot of current surf-relevant conditions
- nearby/favorite spots
- immediate access to Copilot prompts
- recent sessions or recent activity

### Suggested sections
1. **Header**
   - greeting
   - current region
   - quick profile context if useful

2. **Quick Surf Summary**
   - "Best window near you today"
   - "Best favorite spot right now"
   - simple score/confidence

3. **Favorite / Nearby Spot Cards**
   - name
   - current score
   - wind
   - tide trend
   - next-best time

4. **Suggested Prompt Chips**
   - "Best option near me this afternoon"
   - "Compare Cardiff and Seaside at 4pm"
   - "How windy at Del Mar at 3pm?"
   - "What board should I bring right now?"

5. **Session Shortcut**
   - "Log a session"
   - "View recent sessions"

### Keep it light
Avoid making Home a giant dashboard.
Its job is to launch users into decision-making fast.

---

## 4.2 Spot Detail Screen

### Purpose
Act as a stable supporting evidence page for a single spot.

### Suggested sections
1. **Spot Summary**
   - spot name
   - current conditions summary
   - current score
   - personalized score if available
   - confidence label

2. **Best Window / Outlook**
   - next few hours
   - recommended surf window
   - short natural-language summary

3. **Charts**
   - tide graph
   - wind timeline
   - buoy/swell trend
   - optionally surf-window timeline

4. **Copilot Scoped Prompt**
   - input seeded with spot context
   - examples:
     - "How will this change by 3pm?"
     - "What board should I bring here?"
     - "Compare this to Cardiff"

5. **Recent Sessions at This Spot**
   - user's recent sessions
   - average user rating here
   - optional predicted vs actual note later

### Notes
Spot Detail should exist, but it should not need to hold every feature.
It should be a strong evidence page plus a launch point into Copilot.

---

## 4.3 Copilot Screen / Panel

### Purpose
Be the primary intent interface.

### Layout
1. **Prompt input**
2. **Suggested prompts / follow-up chips**
3. **Message thread**
4. **Inline rendered components**
5. **Optional context indicator**
   - current spot
   - current region
   - current time window

### Core behavior
Copilot should:
- answer directly
- render supporting components
- keep context
- ask clarifying questions only when needed
- allow session logging
- not behave like a generic chatbot

### Strong prompt examples
- "Should I surf now or wait until sunset?"
- "Compare Seaside and Del Mar in 2 hours"
- "How bad will the wind be at Cardiff at 3pm?"
- "Log my session from this morning at Del Mar"

---

## 4.4 Sessions Screen

### Purpose
Provide quick access to:
- recent session reports
- session details
- basic insights

### Suggested sections
1. **Recent Sessions List**
   - date
   - spot
   - user score
   - board
   - brief condition note

2. **Session Details**
   - conditions when logged
   - predicted score vs actual score
   - board used
   - notes

3. **Simple Trends**
   - favorite spots by rating
   - conditions user rates highest
   - optional simple chart later

### v1 requirement
Keep this useful but not overbuilt.

---

## 4.5 Profile / Preferences Screen

### Purpose
Allow explicit user preference setup and editing.

### Suggested fields
- skill level
- common board types
- preferred wave size range
- wind tolerance
- drive tolerance
- condition priorities
- home region

### Note
Copilot should help populate this naturally over time, but there should still be a direct edit UI.

---

# 5. Copilot Response Component Spec

The Copilot should render only from a known, reusable component set.

## 5.1 SpotSummaryCard
### Purpose
Fast single-spot answer display.

### Props
- spot_name
- current_score
- personalized_score
- wave_summary
- wind_summary
- tide_summary
- recommended_window
- confidence

### Example use
- "How is Cardiff right now?"

---

## 5.2 SpotComparisonTable
### Purpose
Compare 2-5 spots or time windows.

### Columns
- spot
- time
- wave height
- period
- direction
- wind
- tide
- score
- confidence
- board suggestion

### Example use
- "Compare Del Mar and Seaside at 4pm"

---

## 5.3 TideGraph
### Purpose
Show tide movement for the day.

### Data
- timestamp
- tide_height
- stage
- high/low markers

### Example use
- "What is the tide doing today?"

---

## 5.4 WindTimelineChart
### Purpose
Show hourly wind speed/direction and likely surf impact.

### Data
- timestamp
- wind_speed
- wind_direction
- quality_flag

### Example use
- "How windy will it be at 3pm?"

---

## 5.5 BuoyTrendChart
### Purpose
Show recent swell trend from buoy data.

### Data
- timestamp
- wave_height
- period
- direction

### Example use
- "Has the swell been building?"

---

## 5.6 SurfWindowTimeline
### Purpose
Show best/fair/poor windows over the day.

### Data
- timestamp
- score
- label
- optional rationale

### Example use
- "When is the best time to go today?"

---

## 5.7 RecommendationReasonPanel
### Purpose
Explain why the recommendation was made.

### Fields
- top_recommendation
- reasons[]
- tradeoffs[]
- uncertainty_note

### Example use
- "Why is Seaside better than Cardiff?"

---

## 5.8 EquipmentRecommendationCard
### Purpose
Show board/equipment guidance.

### Fields
- primary_board
- backup_board
- wetsuit_note optional
- expectation_summary

### Example use
- "What board should I bring?"

---

## 5.9 SessionReportCard
### Purpose
Summarize a logged session or preview a session report before save.

### Fields
- spot
- date
- paddle_out_time
- user_score
- board
- notes
- predicted_score
- actual_vs_predicted_summary

---

## 5.10 MapArtifact (optional light v1)
### Purpose
Show nearby spots or ranked options geographically.

### Fields
- spots with lat/lon
- highlight state
- rank/order
- current/forecast summary

### Note
Keep this very simple in v1.

---

# 6. Copilot Interaction Types

## 6.1 Read-only information queries
Examples:
- current conditions
- future conditions
- tide
- wind
- buoy history

## 6.2 Comparison queries
Examples:
- compare 2 spots
- compare time windows
- compare today vs tomorrow

## 6.3 Recommendation queries
Examples:
- where should I go
- when should I go
- what board should I bring

## 6.4 Explanation queries
Examples:
- why is today worse than yesterday
- why is score low if swell is bigger

## 6.5 Session logging queries
Examples:
- log my session
- update session note
- how did this compare to the forecast

---

# 7. Backend API Structure

This spec assumes you continue with **FastAPI** and expand your current endpoints into a cleaner service layer.

## Recommended API groups
- `/api/spots`
- `/api/conditions`
- `/api/tides`
- `/api/wind`
- `/api/buoys`
- `/api/compare`
- `/api/rank`
- `/api/equipment`
- `/api/sessions`
- `/api/preferences`
- `/api/copilot`

---

# 8. REST Endpoint Spec

## 8.1 Spots

### GET /api/spots
Returns all supported spots or filtered spots.

#### Query params
- region
- near_lat
- near_lon
- radius_miles
- favorites_only

#### Response
- list of spot summaries

### GET /api/spots/{spot_id}
Returns metadata for one spot.

#### Response fields
- id
- name
- region
- lat
- lon
- spot_type
- orientation
- tide_notes
- wind_notes
- difficulty
- active

---

## 8.2 Conditions

### GET /api/conditions/current
Get current normalized conditions for a spot.

#### Query params
- spot_id

#### Response fields
- spot_id
- timestamp
- wave_height_ft
- dominant_period_sec
- dominant_direction_deg
- wind_speed_mph
- wind_direction_deg
- tide_height_ft
- tide_stage
- water_temp
- confidence
- summary
- global_score
- personalized_score optional

### GET /api/conditions/window
Get conditions for a time window.

#### Query params
- spot_id
- start
- end
- interval_minutes

#### Response
- list of normalized forecast snapshots
- window summary
- best window hint

---

## 8.3 Tides

### GET /api/tides/timeline
Get tide data for a spot/date.

#### Query params
- spot_id
- date

#### Response fields
- spot_id
- date
- points[]
- highs[]
- lows[]
- current_stage
- summary

---

## 8.4 Wind

### GET /api/wind/timeline
Get wind forecast/history timeline for a spot/date.

#### Query params
- spot_id
- date

#### Response fields
- spot_id
- date
- points[]
- summary
- confidence

---

## 8.5 Buoys

### GET /api/buoys/current
Return current buoy data by station or mapped spot.

#### Query params
- station_id optional
- spot_id optional

### GET /api/buoys/history
Return recent buoy trend data.

#### Query params
- station_id optional
- spot_id optional
- hours default 48

#### Response fields
- station_id
- points[]
- summary

---

## 8.6 Compare

### POST /api/compare/spots
Compare multiple spots for a specified time/window.

#### Request body
```json
{
  "spot_ids": ["cardiff", "del-mar", "seaside"],
  "start": "2026-04-21T15:00:00-07:00",
  "end": "2026-04-21T18:00:00-07:00",
  "user_id": "optional"
}
```

#### Response
- ranked_spots[]
- comparison_rows[]
- summary
- reasons[]
- tradeoffs[]
- confidence

---

## 8.7 Rank

### POST /api/rank/spots
Rank spots by region/time/preferences.

#### Request body
```json
{
  "region": "north-county-san-diego",
  "start": "2026-04-21T15:00:00-07:00",
  "end": "2026-04-21T18:00:00-07:00",
  "drive_radius_miles": 25,
  "user_id": "optional"
}
```

#### Response
- ranked_spots[]
- summary
- explanation

---

## 8.8 Equipment

### POST /api/equipment/recommend
Recommend board/equipment.

#### Request body
```json
{
  "spot_id": "cardiff",
  "time": "2026-04-21T15:00:00-07:00",
  "user_id": "optional"
}
```

#### Response
- primary_board
- backup_board
- rationale[]
- expectation_summary

---

## 8.9 Sessions

### POST /api/sessions
Create a session report.

#### Request body
```json
{
  "spot_id": "cardiff",
  "session_date": "2026-04-21",
  "paddle_out_time": "2026-04-21T07:00:00-07:00",
  "duration_minutes": 90,
  "overall_score": 7,
  "board_type": "fish",
  "perceived_wave_height": "waist_to_chest",
  "perceived_wind_quality": "light_onshore",
  "perceived_shape_quality": "fun",
  "crowd_level": "moderate",
  "notes": "better than expected"
}
```

#### Response
- session_report
- predicted_snapshot
- actual_vs_predicted_summary

### GET /api/sessions
Get user sessions.

#### Query params
- user_id
- spot_id optional
- start_date optional
- end_date optional
- limit

### GET /api/sessions/{session_id}
Get one session detail.

### PATCH /api/sessions/{session_id}
Update a session report.

---

## 8.10 Preferences

### GET /api/preferences/me
Get current user preference profile.

### PUT /api/preferences/me
Update current user preference profile.

#### Fields
- skill_level
- board_preferences
- wave_size_preference
- wind_tolerance
- drive_tolerance_minutes
- priorities
- home_region

---

## 8.11 Copilot

### POST /api/copilot/chat
Main Copilot endpoint.

#### Request body
```json
{
  "messages": [
    {"role": "user", "content": "Should I surf Cardiff in 2 hours?"}
  ],
  "context": {
    "spot_id": "cardiff",
    "region": "north-county-san-diego"
  }
}
```

#### Response
Should support:
- assistant text
- structured artifact list
- follow-up prompts
- optional tool trace in logs only

#### Response shape
```json
{
  "message": {
    "role": "assistant",
    "content": "Cardiff looks rideable in 2 hours but bumpier than this morning..."
  },
  "artifacts": [
    {
      "type": "spot_summary_card",
      "data": {}
    },
    {
      "type": "wind_timeline_chart",
      "data": {}
    }
  ],
  "follow_ups": [
    "Compare it to Del Mar",
    "What board should I bring?"
  ]
}
```

---

# 9. Copilot Tool Layer

The LLM should not directly read raw source payloads every time.
It should call internal tools over normalized data.

## Suggested tool list
- `get_spot_conditions`
- `get_conditions_window`
- `get_tide_timeline`
- `get_wind_timeline`
- `get_buoy_history`
- `compare_spots`
- `rank_spots`
- `recommend_equipment`
- `create_session_report`
- `get_recent_sessions`
- `get_user_preferences`
- `update_user_preferences`

## Recommended orchestration flow
1. parse intent
2. resolve spot/time context
3. call one or more tools
4. compose natural-language answer
5. attach artifacts
6. suggest follow-ups

---

# 10. Suggested Response Artifact Schema

Use a standard artifact envelope.

## Artifact shape
```json
{
  "type": "tide_graph",
  "title": "Cardiff Tide Today",
  "data": {},
  "meta": {
    "spot_id": "cardiff",
    "date": "2026-04-21"
  }
}
```

## Supported v1 artifact types
- `spot_summary_card`
- `spot_comparison_table`
- `tide_graph`
- `wind_timeline_chart`
- `buoy_trend_chart`
- `surf_window_timeline`
- `recommendation_reason_panel`
- `equipment_recommendation_card`
- `session_report_card`
- `map_artifact` optional

---

# 11. Session Report Schema

## SessionReport
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "spot_id": "cardiff",
  "session_date": "2026-04-21",
  "paddle_out_time": "2026-04-21T07:00:00-07:00",
  "duration_minutes": 90,
  "overall_score": 7,
  "board_type": "fish",
  "perceived_wave_height": "waist_to_chest",
  "perceived_wind_quality": "light_onshore",
  "perceived_shape_quality": "fun",
  "crowd_level": "moderate",
  "notes": "better than expected",
  "predicted_snapshot_id": "uuid",
  "predicted_global_score": 6.2,
  "predicted_personalized_score": 7.0,
  "created_at": "2026-04-21T10:15:00-07:00"
}
```

## Suggested enums for v1
### board_type
- shortboard
- fish
- groveler
- twin
- longboard
- midlength
- stepup
- other

### perceived_wave_height
- ankle_knee
- knee_waist
- waist_chest
- chest_head
- overhead
- overhead_plus

### perceived_wind_quality
- glassy
- light_offshore
- light_onshore
- moderate_onshore
- strong_onshore
- mixed
- unknown

### perceived_shape_quality
- poor
- fair
- fun
- good
- epic

### crowd_level
- empty
- light
- moderate
- crowded
- very_crowded

---

# 12. Personalized Score Inputs

## Explicit user profile inputs
- skill_level
- common board choices
- preferred size range
- wind tolerance
- drive tolerance
- priorities ranking

## Inferred inputs from behavior/sessions
- spots user rates highest
- conditions they choose most often
- board used in certain conditions
- score deltas vs model score
- dislike of specific wind/tide patterns

## Suggested v1 priorities model
A simple weighted set:
- cleanliness
- size
- consistency
- crowd avoidance
- convenience
- tide suitability

These can start as user-editable weights or simple tiered preferences:
- low
- medium
- high

---

# 13. Recommended Database Tables

## Core tables
- users
- spots
- forecast_snapshots
- spot_scores
- personalized_scores
- session_reports
- user_preferences
- user_preference_signals
- copilot_conversations optional
- copilot_messages optional

## Minimal v1 requirement
If you want to move fast, the absolute minimum new tables are:
- spots
- session_reports
- user_preferences

And the rest can be computed/stored more lightly at first.

---

# 14. What to Keep from the Current mysurflife App

Based on your current build direction, these are likely worth keeping:

## Keep
- FastAPI backend
- current buoy fetch/parsing infrastructure
- buoy history endpoints
- NOAA/NDBC integration
- CDIP integration direction
- spot/buoy mapping work
- React frontend foundation
- map capability as optional support feature

## Keep but refactor
- current buoy status views
- current summary endpoints
- scoring logic
- forecast interpretation logic

These should move under a more deliberate normalized service layer.

---

# 15. What to Simplify or Remove

## Likely candidates to simplify
- overly dense dashboard screens
- redundant pages that show the same raw data differently
- complex manual filters that Copilot can handle through intent
- rigid one-size-fits-all score displays
- UI branches created only because users could not previously ask questions directly

## Rule
If the feature exists only to compensate for lack of an intent layer, it should be reviewed for reduction.

---

# 16. Frontend Build Priorities

## Phase 1
- Home screen
- Spot detail screen
- basic Copilot panel/page
- reusable chart components
- session log form/modal

## Phase 2
- inline Copilot artifacts
- comparison table
- follow-up prompts
- session history page
- preferences screen

## Phase 3
- richer personalized score display
- map artifact support
- better retrospective insights

---

# 17. Backend Build Priorities

## Phase 1
- normalize current conditions by spot
- normalized tide endpoint
- normalized wind endpoint
- clean buoy history endpoint
- session report create/read
- user preference create/read

## Phase 2
- compare spots endpoint
- rank spots endpoint
- equipment recommendation endpoint
- Copilot chat endpoint with tool routing

## Phase 3
- session learning signals
- retrospective analytics
- personalized score persistence
- artifact builder layer

---

# 18. Example End-to-End v1 Copilot Flows

## Flow: "Should I surf Cardiff in 2 hours?"
1. resolve spot
2. resolve time window
3. call `get_conditions_window`
4. call `recommend_equipment`
5. compose recommendation
6. return spot summary + wind chart + follow-ups

## Flow: "Compare Del Mar and Seaside this afternoon"
1. resolve spots and window
2. call `compare_spots`
3. render comparison table
4. show reason panel

## Flow: "Log my session from this morning"
1. detect logging intent
2. gather missing structured fields
3. call `create_session_report`
4. show session report card
5. optionally generate preference signals

---

# 19. Recommended v1 Delivery Order

## Milestone 1: Product spine
- Home
- Spot Detail
- normalized APIs
- chart components

## Milestone 2: Copilot read-only
- Copilot chat UI
- conditions/tide/wind/compare tools
- inline artifact rendering

## Milestone 3: Session logging
- session create/read/update
- conversational logging
- session cards/history

## Milestone 4: Personalization
- preference profile
- preference-aware ranking
- personalized score

## Milestone 5: Simplification pass
- remove redundant legacy views
- reduce nav clutter
- keep strongest flows only

---

# 20. Recommended Immediate Next Step

The best next doc after this one is:

## **mysurflife v1 implementation plan**
That should include:
- specific frontend tasks
- backend tickets
- database migration list
- API contract order
- component build order
- a trimmed roadmap based on your current repo

---

Generated: 2026-04-21 22:30:20
