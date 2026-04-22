# mysurflife Copilot-Driven Product + Technical Design Spec

## Purpose
This document turns the earlier Copilot-first product idea into a more concrete **design and technical brainstorming spec** for mysurflife.

It is meant to help answer:
- what the product should feel like
- what the minimum UI should include
- what data components the Copilot can render
- what backend tools are needed
- how user session reports can improve personalization over time
- what parts of the current mysurflife app can likely be simplified or removed

---

# 1. Product Thesis

mysurflife should not just be a traditional surf forecast dashboard.

It should become a:

**personalized surf decision engine with a Copilot interface**

Instead of forcing users to:
- browse spot pages
- inspect multiple charts
- compare tides manually
- interpret buoy readings themselves
- guess which board to bring

the product should let them ask things like:
- "Should I surf Cardiff in 2 hours?"
- "Compare Del Mar and Seaside for this afternoon"
- "How windy will it be at 3pm?"
- "What board should I bring?"
- "Was the model right compared to how it actually surfed?"

The app should still provide trust-building visual evidence, but **intent becomes the main navigation layer**.

---

# 2. Product Goals

## Primary goals
1. Aggregate distributed surf-related data into one normalized system
2. Let users retrieve answers in natural language
3. Show supporting visualizations inside Copilot responses
4. Learn each user's preferences over time
5. Let users log surf sessions quickly and naturally
6. Use logged sessions to improve personalized scoring

## Non-goals for v1
- full social network
- complex manual reporting workflows
- overbuilt dashboard navigation
- too many map/filter/settings combinations
- trying to replace all traditional UI immediately

---

# 3. Product Experience Direction

## Core experience
User opens mysurflife and immediately sees:
- a simple surf summary
- favorite spots / nearby spots
- a Copilot prompt box
- a few suggested prompts

Example suggested prompts:
- "Best option near me this afternoon"
- "Compare Del Mar and Cardiff at 4pm"
- "How windy will it be at Seaside at 3pm?"
- "What board should I bring if I go now?"
- "Log my session from this morning"

## Philosophy
The user should feel like they are talking to:
- a surf-savvy data assistant
- not a generic chatbot
- not a dashboard with chat bolted on

---

# 4. Proposed UX Model

## A. Minimal shell UI
The non-chat UI should be intentionally light.

### Home screen / landing shell
Could contain:
- current conditions snapshot
- favorite / recent spots
- quick launch prompts
- optional mini map
- session log shortcut
- Copilot pane or button

### Spot detail page
Could be simplified to:
- current summary
- next few hours
- basic charts
- recent buoy / tide / wind visuals
- Copilot prompt scoped to this spot

### Session logging entry
Could be:
- quick structured form
- or conversational logging through Copilot
- ideally both

## B. Copilot as primary navigation
The Copilot should be able to:
- answer direct questions
- compare places and times
- explain conditions
- render visual components inline
- ask follow-up questions only when needed
- remember user preferences over time

## C. Traditional UI stays as trust / verification layer
Important:
The chat should not replace all UI.
It should orchestrate and personalize.
The traditional UI should remain useful for:
- browsing
- verification
- quick glances
- visual trust
- direct control

---

# 5. What Users Actually Want

This is the product anchor.

Users are not really asking for "data."
They are asking for decisions and expectations.

Examples:
- "Should I go?"
- "Which spot is better?"
- "When should I leave?"
- "How bad will the wind be?"
- "What board should I bring?"
- "Will it be better than yesterday?"
- "What should I expect when I paddle out?"

So the product should answer in terms of:
- recommendation
- comparison
- explanation
- expectation
- equipment choice
- confidence

---

# 6. Personalized Spot Scoring

## Why static scores are weak
A fixed spot score is not enough because surfers differ by:
- skill level
- board type
- preferred wave size
- tolerance for wind
- tolerance for crowd
- desire for shape vs size
- willingness to drive
- preferred tide windows

So instead of:
- "Cardiff = 7.2"

the product should move toward:
- "Cardiff = 7.2 for you right now"

## Personalized score inputs
Possible inputs:
- user skill level
- board quiver / preferences
- favorite conditions
- wind tolerance
- ideal wave height range
- ideal tide range
- crowd tolerance
- willingness to drive
- preferred surf style:
  - longboard
  - fish / funboard
  - performance shortboard
  - beginner / mellow
  - down-the-line / shape
  - punchy / powerful

## Copilot role in score setup
Copilot can help establish preferences naturally:
- "Do you prefer cleaner smaller surf or bigger messier surf?"
- "What board do you ride most often?"
- "Do you care more about wind or size?"
- "How far will you drive for better conditions?"

This is better than a long settings form.

## Score model direction
Think in layers:
1. **Global score** based on objective conditions
2. **Spot-specific score** based on break behavior
3. **User-personalized score** based on preferences
4. **Confidence score** based on data quality and uncertainty

---

# 7. Session Reports as Learning Loop

This is one of the strongest ideas.

## User workflow
After a surf session, user can log:
- where they surfed
- when
- what conditions felt like
- what board they rode
- how good it was
- maybe crowd / parking / vibe notes
- maybe photos later

## Why this matters
This creates a feedback loop:
- predicted conditions vs actual user experience
- model score vs user score
- board recommendation vs board actually used
- user satisfaction vs raw data

This is how mysurflife can become smarter for each individual user.

## Example Copilot session log flow
User:
- "Log my session from this morning at Cardiff"

Copilot:
- "What time did you paddle out?"
- "What board did you ride?"
- "How would you rate it from 1-10?"
- "How was the wind / shape / crowd?"
- "Was it better or worse than expected?"

## Session report fields
### Required
- user_id
- spot_id
- session_date
- paddle_out_time
- approximate duration
- overall_score (1-10)

### Very useful
- board_type
- perceived_wave_height
- perceived_wind_quality
- tide_feel
- crowd_level
- consistency
- shape_quality
- fun_factor
- notes

### System-captured at log time
- predicted_conditions_snapshot
- predicted_score_at_session_time
- buoy/tide/wind values used
- forecast window
- model confidence

## Learning opportunities
Over time the system can learn:
- user likes lower tide at certain spots
- user dislikes onshore wind more than average
- user rates shoulder-high clean surf much higher than bigger choppy surf
- user tends to prefer longboard-friendly conditions
- certain spots systematically overperform or underperform relative to model

---

# 8. Suggested UI Components Copilot Can Render

The Copilot should not invent arbitrary UI.
It should render from a known component library.

## Core response components

### 1. Spot Summary Card
Shows:
- spot name
- current score
- personalized score
- condition summary
- recommended window
- quick confidence label

### 2. Comparison Table
Useful for:
- comparing 2-5 spots
- comparing different times
Columns may include:
- spot
- wave height
- period
- direction
- wind
- tide
- score
- confidence
- board suggestion

### 3. Tide Graph
Use cases:
- "What is the tide doing today?"
- "Will the tide be better at 3pm?"
Needs:
- current tide stage
- rising/falling
- highs/lows annotated

### 4. Wind Timeline Chart
Use cases:
- "How windy will it be at 3pm?"
- "Will it clean up this evening?"
Needs:
- hourly speed
- direction
- maybe onshore/offshore classification

### 5. Surf Window Timeline
A simplified graph of:
- best / fair / poor over the day
- recommended time windows

### 6. Buoy Trend Chart
Useful for:
- swell build/drop
- period changes
- direction shifts
- last 24-48 hours

### 7. Map View
Could render:
- nearby spots
- drive radius
- top picks
- wind or swell overlay later
For v1, keep this simple.

### 8. "Why This Recommendation" Panel
This is important for trust.
Shows:
- light wind
- favorable tide
- cleaner than alternate spots
- size better for your preferences

### 9. Equipment Recommendation Card
Shows:
- best board choice
- backup board choice
- wetsuit notes maybe later
- expectations

### 10. Session Report Summary Card
After logging a session:
- where
- when
- conditions
- rating
- differences from prediction

---

# 9. Copilot Query Types

The backend should support several major query patterns.

## A. Direct fact retrieval
Examples:
- "How windy will it be at 3pm at Cardiff?"
- "What is the tide doing today at Del Mar?"

## B. Recommendation
Examples:
- "Where should I go this afternoon?"
- "Best beginner spot near me tomorrow morning?"

## C. Comparison
Examples:
- "Compare Seaside and Del Mar at sunset"
- "Which will be cleaner, Cardiff or Blacks?"

## D. Explanation
Examples:
- "Why is today worse than yesterday?"
- "Why is the score low if the swell is bigger?"

## E. Expectation / equipment
Examples:
- "What should I expect when I show up?"
- "What board should I bring?"

## F. Logging / memory
Examples:
- "Log my session"
- "How did this compare to my last Cardiff session?"

---

# 10. Functional Scope for v1

## Must-have
- current conditions by spot
- near-future hourly conditions
- tide lookup
- wind lookup
- basic comparison between spots
- Copilot answer generation
- visual rendering in chat
- session logging
- user profile basics
- initial preference capture

## Nice to have
- favorites
- saved prompts
- drive-radius ranking
- session history
- chart sharing
- confidence labels
- recommendation explanations

## Defer / later
- advanced social features
- photo/video uploads
- gamification
- public reports
- complex map overlays
- advanced machine learning personalization

---

# 11. Recommended Data Model Direction

Below is a practical conceptual model.

## Core entities

### User
- id
- email
- name
- home_location
- skill_level
- drive_tolerance_minutes
- board_preferences
- surf_preferences_json
- created_at
- updated_at

### Spot
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

### ForecastSnapshot
Represents normalized conditions for a spot and time.
- id
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
- source_snapshot_json

### SpotScore
- id
- spot_id
- timestamp
- global_score
- reasoning_json
- model_version

### PersonalizedScore
- id
- user_id
- spot_id
- timestamp
- personalized_score
- score_factors_json
- explanation_json

### SessionReport
- id
- user_id
- spot_id
- session_date
- paddle_out_time
- duration_minutes
- overall_score
- board_type
- perceived_wave_height
- perceived_wind_quality
- perceived_shape_quality
- crowd_level
- notes
- predicted_snapshot_id
- predicted_global_score
- predicted_personalized_score
- created_at

### UserPreferenceSignal
This can accumulate learned preferences over time.
- id
- user_id
- signal_type
- signal_value
- weight
- source
- created_at

Examples:
- prefers_clean_over_large
- dislikes_strong_onshore
- likes_mid_tide_at_cardiff
- prefers_longboard_conditions

### CopilotConversation / CopilotMessage
Optional depending on architecture.
Useful for:
- storing chat history
- restoring context
- audit
- UX continuity

---

# 12. Tool / API Layer

The Copilot should call product-grade tools.
Do not let the model directly interpret raw NOAA/CDIP blobs each time.

## Suggested v1 tools

### get_spot_conditions
Inputs:
- spot_id
- time or time window

Returns:
- normalized conditions
- summary
- score inputs

### compare_spots
Inputs:
- spot_ids
- time window
- user_id optional

Returns:
- ranked comparison
- differences
- recommendation notes

### get_tide_timeline
Inputs:
- spot_id
- date

Returns:
- highs/lows
- hourly tide curve
- stage summary

### get_wind_timeline
Inputs:
- spot_id
- date

Returns:
- hourly speed/direction
- quality flags

### get_buoy_history
Inputs:
- buoy_id or spot_id
- range

Returns:
- trend series
- swell components

### rank_spots
Inputs:
- region
- time window
- user preferences
- drive radius

Returns:
- top options
- reasons
- confidence

### explain_conditions
Inputs:
- spot_id
- time window
- user_id optional

Returns:
- explanation narrative
- structured explanation bullets

### recommend_equipment
Inputs:
- spot_id
- time window
- user profile

Returns:
- primary board suggestion
- backup board
- expectations

### log_session_report
Inputs:
- structured session info

Returns:
- saved session
- prediction comparison
- follow-up suggestions

### learn_user_preference_signal
This can be internal rather than directly exposed.
Triggered when:
- user logs a session
- user upvotes/downvotes guidance
- user selects alternate board or alternate spot

---

# 13. Copilot System Behavior

## Copilot should do well
- answer naturally
- ask clarifying questions only when needed
- use user context
- use location context if allowed
- provide concise actionable recommendations
- render evidence
- explain reasoning

## Copilot should not do
- overtalk
- hallucinate data not present
- hide uncertainty
- claim precision when confidence is low
- invent spot details
- mutate user data without confirmation

## Desired answer style
A strong answer might include:
1. direct answer
2. short recommendation
3. what to expect
4. board suggestion
5. visual evidence
6. confidence / uncertainty note when needed

Example:
"At 3pm Cardiff looks rideable but a bit bumpier than this morning. Wind is expected around 9-11 mph onshore, tide will be dropping, and swell remains fun-sized. Bring a fish or groveler if you want more waves. A performance shortboard may feel underpowered unless the sets are more consistent than forecast."

---

# 14. What We May Not Need in the Existing mysurflife App

Based on this direction, some existing or planned UI may be simplified, reduced, or removed.

## Possible reductions
- too many dedicated navigation layers
- overly dense dashboard pages
- multiple redundant views of the same data
- feature ideas that only exist because users otherwise cannot ask directly
- complex manual filters that Copilot can handle via intent
- static "one size fits all" scoring views

## Keep / simplify instead
- map as optional supporting view
- buoy detail page as supporting evidence view
- spot page as stable landing surface
- favorites / recent spots
- a simple forecast summary screen
- quick access to session logging

The general rule:
If a feature exists only because the user previously had no way to ask for the answer directly, it may now be a candidate to reduce or remove.

---

# 15. Suggested Frontend Direction

Given your current stack direction, a practical frontend could be:

- React frontend
- Copilot chat panel / full-screen mobile mode
- shared visualization component library
- optional map component
- lightweight spot pages
- session log flow

## Suggested top-level frontend modules
- App shell
- Home / summary
- Spot detail
- Copilot
- Visualization library
- Session log
- User preferences
- Favorites / history

## Copilot UI components
- Prompt box
- Suggested prompts
- Message thread
- Inline charts/tables/cards/maps
- Follow-up chips
- Session-log structured cards
- Action confirmations

---

# 16. Suggested Backend Direction (Fits Existing mysurflife)

A practical evolution of your current backend:

## Current strengths to reuse
You already have pieces of:
- FastAPI
- buoy status endpoints
- buoy history endpoints
- live NDBC data handling
- mapping of buoy to wind station
- some domain logic around wave/surf interpretation

## Add next
1. normalized forecast service layer
2. spot abstraction layer
3. scoring service
4. user preference service
5. session report service
6. Copilot tool router
7. chat orchestration service
8. visualization response schema

## Suggested backend module areas
- `/api/spots`
- `/api/forecast`
- `/api/tides`
- `/api/wind`
- `/api/compare`
- `/api/session-reports`
- `/api/copilot`
- `/api/user-preferences`

Internal services:
- forecast_normalizer
- spot_ranking_service
- personalized_scoring_service
- session_learning_service
- response_artifact_builder

---

# 17. Personalization / Learning Strategy

## Phase 1: Explicit preferences
Ask the user directly:
- skill
- favorite boards
- size preference
- wind tolerance
- drive radius

## Phase 2: Session-based learning
Infer from reports:
- what they liked
- what they disliked
- how they scored sessions
- what they actually surfed

## Phase 3: Behavior-based learning
Infer from app behavior:
- spots viewed
- prompts asked
- conditions acted on
- board recommendations accepted
- recurring choices

## Important rule
Keep learning explainable.
Do not create a black-box score that users cannot understand.

Use phrases like:
- "Your score favors cleaner wind more heavily because of your past session ratings"
- "You tend to rate mid-tide Cardiff sessions higher than low-tide ones"

That is powerful and trustworthy.

---

# 18. Example End-to-End User Flows

## Flow 1: Quick decision
User:
- "Should I surf in 2 hours, Cardiff or Del Mar?"

System:
1. resolve candidate spots
2. fetch forecast window
3. compare wind/tide/swell
4. apply personalized scoring
5. return recommendation + comparison table + board suggestion

## Flow 2: Tide question
User:
- "What is the tide doing today at Seaside?"

System:
1. fetch tide timeline
2. summarize highs/lows and trend
3. render tide graph

## Flow 3: Equipment guidance
User:
- "What should I bring if I go to Blacks at 3pm?"

System:
1. fetch conditions
2. map to board recommendation
3. explain expectations
4. show spot summary

## Flow 4: Session report logging
User:
- "Log my session from this morning at Cardiff"

System:
1. identify spot/date/time
2. ask for score, board, feel
3. store session report
4. compare actual vs predicted
5. generate preference signals

## Flow 5: Retrospective insight
User:
- "How accurate has mysurflife been for me at Cardiff?"

System:
1. retrieve prior reports
2. compare predicted vs actual
3. summarize bias
4. suggest scoring adjustments

---

# 19. Design Questions to Brainstorm

These are good product/design workshop questions.

## Product questions
- Should Copilot be the main home screen or a tab?
- Should spot pages exist as separate screens or mostly as Copilot context surfaces?
- How much does the user need to configure upfront?
- What is the right balance between recommendations and raw charts?
- How should confidence be shown?
- When should the app say "not enough confidence"?

## Session logging questions
- Should logging be mostly conversational or mostly form-based?
- What is the minimum friction to get useful reports?
- Should users score the session numerically, descriptively, or both?
- What fields are truly useful vs too much friction?

## Visualization questions
- Which charts matter most in v1?
- Is a map really critical early, or just nice to have?
- How much UI should render inline in chat vs on dedicated pages?

## Learning questions
- What preference signals should be explicit vs inferred?
- How should the app explain personalized score changes?
- How can we prevent overfitting to too few reports?

---

# 20. Recommended Build Sequence

## Phase 1: Product spine
- stabilize spot model
- normalize data
- create summary APIs
- build minimal spot detail views
- build basic charts

## Phase 2: Copilot read-only
- Copilot prompt box
- read-only tools:
  - get conditions
  - compare spots
  - tide
  - wind
  - buoy history
  - equipment recommendation

## Phase 3: Personalized scoring
- user preference profile
- initial scoring weights
- preference-aware ranking

## Phase 4: Session reports
- conversational logging
- structured storage
- predicted vs actual comparison
- session history

## Phase 5: Learning loop
- infer preference signals
- refine personalized score
- add retrospective insights

## Phase 6: Optimization / simplification
- remove redundant UI
- keep only components users truly use
- double down on Copilot-led flows

---

# 21. Recommendation Summary

For mysurflife, the best direction is likely:

## Build
- a lightweight trustworthy core UI
- a strong Copilot layer
- structured backend tools
- reusable charts/cards/tables/maps
- session logging
- personalized scoring based on real feedback

## Avoid
- overbuilding dashboards
- overdesigning navigation
- trying to precompute every view
- making AI the only surface
- building too many features before validating query patterns

## Product positioning
mysurflife should become:

**A personalized surf decision and learning system**
not just
**a surf forecast website**

---

# 22. Immediate Next Spec to Create

The next most useful design doc after this one would be:

## Recommended next document
**mysurflife v1 component + API spec**

That should define:
- exact frontend screens
- exact Copilot components
- exact backend endpoints
- request/response shapes
- session report schema
- personalized score inputs
- what existing mysurflife features stay / go

---

Generated: 2026-04-21 22:26:56
