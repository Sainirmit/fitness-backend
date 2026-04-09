# MyTrainr backend — API reference for frontend integration

**Conventions**

- **JSON**: Send `Content-Type: application/json` on bodies that carry JSON.
- **Auth**: Protected routes expect  
  `Authorization: Bearer <accessToken>`  
  where `accessToken` is the string returned by `POST /api/auth/google` or `POST /api/auth/apple`.
- **JWT**: Signed with `JWT_SECRET`; expiry from env `JWT_EXPIRES_IN` (default **`7d`** if unset).
- **Errors**: Non-2xx responses typically include `{ "message": "..." }`. Validation / duplicate key / cast errors may use 400 / 409 with messages from the global error handler.
- **401 (protected routes)**: Typical messages are `Authorization header missing or malformed. Expected: Bearer <token>`, `Access token is invalid or has expired.`, or `User belonging to this token no longer exists.` (see `src/middleware/auth.js`).

### Quick reference — all HTTP routes

| Method | Path | Auth |
| ------ | ---- | ---- |
| `GET` | `/` | No |
| `GET` | `/health` | No |
| `POST` | `/api/auth/google` | No |
| `POST` | `/api/auth/apple` | No |
| `POST` | `/api/auth/logout` | Yes |
| `GET` | `/api/users/me` | Yes |
| `PATCH` | `/api/users/me` | Yes |
| `PUT`, `POST` | `/api/body-details` | Yes |
| `GET` | `/api/body-details` | Yes |
| `GET` | `/api/body-photos/upload-url` | Yes |
| `GET` | `/api/body-photos/access-url/:photoId` | Yes |
| `POST` | `/api/body-photos` | Yes |
| `GET` | `/api/body-photos` | Yes |
| `GET` | `/api/body-photos/:id` | Yes |
| `PATCH` | `/api/body-photos/:id` | Yes |
| `DELETE` | `/api/body-photos/:id` | Yes |
| `POST` | `/api/workout-plans/generate` | Yes |
| `GET` | `/api/workout-plans/generation-status/:planId` | Yes |
| `GET` | `/api/workout-plans/current` | Yes |
| `GET` | `/api/workout-plans/refinement-status/:bodyPhotosId` | Yes |
| `GET` | `/api/workout-plans/occurrences` | Yes |
| `POST` | `/api/workout-plans/occurrences/ensure` | Yes |
| `POST` | `/api/workout-plans/current/reset-template-status` | Yes |
| `POST` | `/api/workout-sessions/start` | Yes |
| `POST` | `/api/workout-sessions/check-missed` | Yes |
| `GET` | `/api/workout-sessions/:sessionId` | Yes |
| `GET` | `/api/workout-sessions/:sessionId/progress` | Yes |
| `PUT` | `/api/workout-sessions/:sessionId/exercises/:sessionExerciseId/sets/:setNumber` | Yes |
| `POST` | `/api/workout-sessions/:sessionId/sets/batch` | Yes |
| `POST` | `/api/workout-sessions/:sessionId/complete` | Yes |
| `GET` | `/api/home/dashboard` | Yes |
| `GET` | `/api/home/workout-replacements` | Yes |
| `POST` | `/api/home/workout-replacements` | Yes |
| `DELETE` | `/api/home/workout-replacements/:replacementId` | Yes |

**Timezone:** Many handlers resolve IANA time via `x-timezone` header, optional `timeZone` query/body (where supported), then `user.timeZone`, then `UTC` (`src/utils/timezone.js`). Sending a valid `x-timezone` on app open updates `user.timeZone` when it changes (`syncUserTimeZoneFromHeader`).

---

## Server root

### API name

Health / welcome

### Function

Confirm the API process is running.

### Route

`GET /`

### Payload

None.

### Auth / headers / params

None.

### Response format

**200** — JSON:

```json
{ "message": "AI Fitness Backend API is running!" }
```

### Additional details

Useful for sanity checks in dev tools.

---

## Health check

### API name

Health check

### Function

Liveness check with server timestamp.

### Route

`GET /health`

### Payload

None.

### Auth / headers / params

None.

### Response format

**200** — JSON:

```json
{ "status": "OK", "timestamp": "<ISO-8601 string>" }
```

---

## Google sign-in

### API name

Google login (Firebase ID token exchange)

### Function

Verify a Firebase ID token from Google Sign-In, find or create a user, return a backend JWT for subsequent requests.

### Route

`POST /api/auth/google`

### Payload

JSON body:

| Field     | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| `idToken` | string | yes      | Firebase ID token from the client SDK |

Example:

```json
{ "idToken": "<Firebase ID token>" }
```

### Auth / headers / params

No `Authorization` header. No query params.

### Response format

**200** — JSON:

```json
{
  "accessToken": "<JWT>",
  "isNewUser": true,
  "user": {}
}
```

`user` is the full Mongoose user document (email, provider, onboarding fields, etc.).

**400** — Missing/invalid `idToken`, or Google account has no email.

**401** — Firebase token invalid or expired.

### Additional details

- Account is keyed by Firebase-verified email + provider `google`.
- Store `accessToken` securely on the client; send it as `Bearer` on protected routes.

---

## Apple sign-in

### API name

Apple login (Firebase ID token exchange)

### Function

Same as Google: verify Firebase token, find or create user (`provider: "apple"`), return JWT.

### Route

`POST /api/auth/apple`

### Payload

JSON body:

| Field     | Type   | Required | Description                                |
| --------- | ------ | -------- | ------------------------------------------ |
| `idToken` | string | yes      | Firebase ID token after Apple Sign-In      |
| `user`    | object | no       | Apple only sends name on **first** sign-in |

Optional `user` shape (when provided):

```json
{
  "idToken": "<Firebase ID token>",
  "user": {
    "name": {
      "firstName": "Jane",
      "lastName": "Doe"
    }
  }
}
```

If `user` is present, it must be an object (middleware validation).

### Auth / headers / params

No `Authorization`. No query params.

### Response format

**200** — Same shape as Google:

```json
{
  "accessToken": "<JWT>",
  "isNewUser": false,
  "user": {}
}
```

**400** — Invalid body; Apple account must have email.

**401** — Token invalid or expired.

---

## Logout

### API name

Logout

### Function

Stateless acknowledgement so the client can clear stored tokens. The server does not invalidate JWTs server-side.

### Route

`POST /api/auth/logout`

### Payload

None required (empty body is fine).

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>` (`protect` middleware).

### Response format

**200** — JSON:

```json
{ "message": "Logged out successfully." }
```

**401** — Missing/malformed `Authorization`, invalid/expired token, or user deleted.

---

## Get current user

### API name

Get authenticated user profile

### Function

Return the latest user document for the JWT subject.

### Route

`GET /api/users/me`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

You may send `x-timezone` on this request for consistency, but **`GET /api/users/me` does not persist timezone or touch occurrences** — it only returns the user document. Prefer sending `x-timezone` on **`GET /api/home/dashboard`**, **`POST /api/workout-plans/generate`**, **`GET /api/workout-plans/current`**, **`POST /api/workout-sessions/start`**, and **`POST /api/workout-plans/occurrences/ensure`** so the server can sync `user.timeZone` and compute local dates correctly.

### Response format

**200** — JSON:

```json
{ "user": {} }
```

`user` includes fields such as `email`, `provider`, `name`, `fitnessGoals`, `onboardingCompleted`, `hasUnlockedPlan`, `hasBodyPhotos`, `currentWorkoutPlan`, etc.

**401** — Invalid/missing token.

---

## Update current user (onboarding)

### API name

Patch current user (+ optional BodyDetails upsert)

### Function

Partial update of allowed user fields. If body-metric fields are sent (`gender`, `age`, `weight`, `height`), the server also upserts **BodyDetails** for that user (same as dedicated body-details flow).

### Route

`PATCH /api/users/me`

### Payload

JSON body — **only include fields you want to change.**  
**Forbidden** (400 if present): `email`, `provider`, `providerId`, `hasUnlockedPlan`.

Common fields (all optional unless you are setting them):

| Field                           | Type     | Notes                                              |
| ------------------------------- | -------- | -------------------------------------------------- |
| `name`                          | string   | Trimmed                                            |
| `fitnessGoals`                  | string[] | Normalized values                                  |
| `fitnessLevel`                  | string   | e.g. `beginner`                                    |
| `motivations`                   | string[] |                                                    |
| `gender`                        | string   | Triggers BodyDetails upsert with other body fields |
| `age`                           | number   |                                                    |
| `weight`                        | number   | In `weightUnit`                                    |
| `weightUnit`                    | string   | `kg` \| `lbs` (stored as kg server-side)           |
| `height`                        | number   | Total inches if `heightUnit` is `ft_in`            |
| `heightUnit`                    | string   | `cm` \| `ft_in` (stored as cm)                     |
| `workoutEnvironment`            | string   | e.g. `gym` \| `home`                               |
| `weightliftingExperience`       | boolean  |                                                    |
| `workoutDays`                   | string[] | e.g. `["mon","wed","fri"]`                         |
| `preferredWorkoutTime`          | string   |                                                    |
| `activityLevelApartFromWorkout` | string   |                                                    |
| `focusAreas`                    | string[] |                                                    |
| `dietType`                      | string   |                                                    |
| `mealsPerDay`                   | number   | 2–10                                               |
| `onboardingCompleted`           | boolean  | Set `true` when onboarding is finished             |

Example (phase 1):

```json
{
  "name": "Jane",
  "fitnessGoals": ["lose_weight", "build_muscle"],
  "fitnessLevel": "beginner",
  "motivations": ["health_wellbeing", "stress_relief"]
}
```

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — JSON:

```json
{
  "user": {},
  "bodyDetails": {}
}
```

`bodyDetails` is **only included** when at least one of `gender`, `age`, `weight`, `height` was present in the request.

**400** — Protected field in body, or validation error from Mongoose.

**401** — Invalid token.

---

## Upsert body details snapshot

### API name

Create body-metrics snapshot (PUT or POST)

### Function

Creates a new **BodyDetails** snapshot for the user (used for history / latest metrics). Prefer **`PUT`**; **`POST`** behaves the same (duplicate-safe for older clients).

### Route

`PUT /api/body-details`  
`POST /api/body-details`

### Payload

JSON body — send at least one recognized field:

| Field        | Type   | Required | Notes                                |
| ------------ | ------ | -------- | ------------------------------------ |
| `gender`     | string | no\*     |                                      |
| `age`        | number | no\*     |                                      |
| `weight`     | number | no\*     | In `weightUnit`                      |
| `weightUnit` | string | no\*     | `kg` \| `lbs`                        |
| `height`     | number | no\*     |                                      |
| `heightUnit` | string | no\*     | `cm` \| `ft_in`                      |
| `recordedAt` | string | no       | ISO date string to backdate snapshot |

\*Together, fields must allow the service to persist something meaningful; otherwise **400**.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — JSON:

```json
{ "bodyDetails": {} }
```

**400** — Nothing to save.

**401** — Invalid token.

---

## List body details snapshots

### API name

List body details history

### Function

Returns all BodyDetails documents for the user, newest first, unless `latest=true`.

### Route

`GET /api/body-details`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Query:**

| Param    | Values | Effect                                                         |
| -------- | ------ | -------------------------------------------------------------- |
| `latest` | `true` | Returns **at most one** document in an array (latest snapshot) |

Example: `GET /api/body-details?latest=true`

### Response format

**200** — JSON:

```json
{ "bodyDetails": [{}, {}] }
```

With `latest=true`, `bodyDetails` is either `[]` or `[ singleDocument ]`.

**401** — Invalid token.

---

## Presigned upload URL (body photos)

### API name

Get S3 upload URL for front or side photo

### Function

Returns a short-lived URL to **PUT** the image bytes directly to S3, plus the **public URL** to store on `POST /api/body-photos`.

### Route

`GET /api/body-photos/upload-url`

### Payload

None (use query string).

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Query (all required):**

| Param         | Type   | Description                                     |
| ------------- | ------ | ----------------------------------------------- |
| `fileName`    | string | Original file name (used to build a unique key) |
| `contentType` | string | e.g. `image/jpeg`                               |
| `imageType`   | string | **`front`** or **`side`**                       |

### Response format

**200** — JSON:

```json
{
  "signedUrl": "https://...",
  "fileName": "<final S3 key>",
  "publicUrl": "https://<bucket>.s3.<region>.amazonaws.com/<key>"
}
```

**400** — Missing query fields or invalid `imageType`.

**401** — Invalid token.

### Additional details

1. `PUT signedUrl` with raw body = image bytes, `Content-Type` matching what you requested.
2. After both images are uploaded, call **`POST /api/body-photos`** with `frontImageUrl` / `sideImageUrl` set to the returned **`publicUrl`** values (see below).

---

## Create body photo set (starts AI pipeline)

### API name

Register uploaded photos + queue enhancement

### Function

Persists front/side URLs, sets `hasBodyPhotos` on the user, and **queues** async work: vision analysis + workout plan generation/refinement. Response returns immediately with `refinementStatus: "queued"`.

### Route

`POST /api/body-photos`

### Payload

JSON body:

| Field           | Type   | Required | Description                                           |
| --------------- | ------ | -------- | ----------------------------------------------------- |
| `frontImageUrl` | string | yes      | Public S3 URL for front image                         |
| `sideImageUrl`  | string | yes      | Public S3 URL for side image                          |
| `bodyDetailsId` | string | no       | Mongo ObjectId of a BodyDetails doc **for this user** |
| `periodType`    | string | no       | e.g. onboarding label / progress period               |

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**201** — JSON:

```json
{
  "message": "Body photos created successfully",
  "bodyPhotos": {},
  "refinementStatus": "queued"
}
```

`bodyPhotos` includes `_id` (use for polling refinement status), `analysisStatus` (initially `pending`), etc.

**400** — Missing URLs; invalid `bodyDetailsId`.

**401** — Invalid token.

**500** — Server error message in `message` / `error`.

### Additional details

- Poll **`GET /api/workout-plans/refinement-status/:bodyPhotosId`** until `status` is `completed` or `failed`.
- If stage 2 succeeds, a new active plan exists (or replaces a previous active plan). Use **`GET /api/workout-plans/current`** to load it.

---

## List body photo sets

### API name

List body photos

### Function

Paginated list; image URLs in the response are **signed** for viewing.

### Route

`GET /api/body-photos`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Query (optional):**

| Param        | Default | Description      |
| ------------ | ------- | ---------------- |
| `page`       | `1`     | Page number      |
| `limit`      | `20`    | Page size        |
| `periodType` | —       | Filter by period |

### Response format

**200** — JSON:

```json
{
  "bodyPhotos": [{}],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "pages": 0
  }
}
```

**401** — Invalid token.

---

## Get body photo set by ID

### API name

Get one body photo record

### Function

Returns one document; `frontImageUrl` / `sideImageUrl` are **signed** for display.

### Route

`GET /api/body-photos/:id`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `id` — BodyPhotos `_id`.

### Response format

**200** — JSON:

```json
{ "bodyPhotos": {} }
```

**404** — Not found or not owned by user.

**401** — Invalid token.

---

## Update body photo set

### API name

Patch body photo metadata

### Function

Update `periodType` and/or `bodyDetails` link.

### Route

`PATCH /api/body-photos/:id`

### Payload

JSON body (optional fields):

| Field           | Type   | Description            |
| --------------- | ------ | ---------------------- |
| `periodType`    | string |                        |
| `bodyDetailsId` | string | Sets `bodyDetails` ref |

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `id` — BodyPhotos `_id`.

### Response format

**200** — JSON:

```json
{
  "message": "Body photos updated successfully",
  "bodyPhotos": {}
}
```

**404** — Not found.

**401** — Invalid token.

---

## Delete body photo set

### API name

Delete body photos

### Function

Deletes S3 objects (if resolvable) and removes the DB record.

### Route

`DELETE /api/body-photos/:id`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `id` — BodyPhotos `_id`.

### Response format

**200** — JSON:

```json
{ "message": "Body photos deleted successfully" }
```

**404** — Not found.

**401** — Invalid token.

---

## Access URL for one image

### API name

Signed URL for viewing a stored image

### Function

Returns a temporary URL to display front or side image for a given BodyPhotos id.

### Route

`GET /api/body-photos/access-url/:photoId`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `photoId` — BodyPhotos `_id`.

**Query (required):**

| Param       | Values            |
| ----------- | ----------------- |
| `imageType` | `front` \| `side` |

### Response format

**200** — JSON:

```json
{
  "signedUrl": "https://...",
  "imageType": "front"
}
```

**400** — Bad `imageType` or URL not parseable.

**404** — BodyPhotos not found.

**401** — Invalid token.

---

## Generate workout plan (calendar-mapped, 3 weeks)

### API name

Generate AI workout plan (calendar-shaped)

### Function

Archives any existing **active** plan, starts background LLM generation with onboarding + body details + exercise catalog, and builds a **3-week (21-day) calendar-mapped plan** from the user's current local date. Each of the **21 days** is stored as a `WorkoutDay` record with `scheduledDateKey` (YYYY-MM-DD); rest days are explicitly included with `isRestDay: true`.

### Route

`POST /api/workout-plans/generate`

### Payload

None (uses server-side user + BodyDetails + rules).

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Recommended header:** `x-timezone: <IANA timezone>` (e.g. `America/New_York`).
The backend resolves the user's "today" from this header (fallback: saved `user.timeZone` → `UTC`). The AI uses this to map workouts to real calendar dates.

### Response format

**202** — JSON (generation accepted, still running):

```json
{
  "message": "Plan generation started. Poll generation-status for progress.",
  "workoutPlanId": "<placeholderPlanId>",
  "status": "generating"
}
```

Then poll:

- `GET /api/workout-plans/generation-status/:planId`
- Recommended interval: **10 seconds**
- Polling is **client-driven** (it runs automatically only if frontend sets an interval/timer)

Status examples:

```json
{ "status": "generating" }
```

```json
{ "status": "completed", "workoutPlanId": "<activePlanId>" }
```

```json
{ "status": "failed", "error": "<reason>" }
```

After status is `completed`, fetch full plan from `GET /api/workout-plans/current`.

Key differences from old template-shaped plan:
- `workoutPlan.planShape` is `"calendar"` (old plans have `"template"`)
- A full generated calendar plan has **21** `WorkoutDay` rows (one per calendar date in range)
- Each day has `scheduledDateKey` and `isRestDay`
- No separate `occurrences` or `occurrenceMappingMeta` — calendar days are self-contained

**400** — Missing onboarding fields: `fitnessGoals`, `fitnessLevel`, `workoutEnvironment`, `workoutDays`, `focusAreas` (checked **before** the job is queued).

**403** — `hasUnlockedPlan` is false (paywall).

**Background failures (poll for these):** If **BodyDetails** are missing, the exercise catalog is empty, or generation throws, the placeholder plan moves to `failed` and **`GET /api/workout-plans/generation-status/:planId`** returns `{ "status": "failed", "error": "..." }` (e.g. *Body details are required before generating a plan.*). The synchronous `POST` still returns **202** as long as onboarding + unlock checks pass.

**401** — Invalid token.

### Additional details

- Ensure **`PATCH /api/users/me`** (or **`PUT`/`POST /api/body-details`**) has populated **BodyDetails** before calling; otherwise generation fails in the background (see poll `failed` status above).
- Always send a valid IANA `x-timezone` (e.g. `America/New_York`; `America` alone is invalid and falls back to UTC).
- Frontend should start polling `generation-status` every **10s** right after `POST /generate` returns 202.
- No need to call `POST /api/workout-plans/occurrences/ensure` for calendar plans — occurrences are baked in.

---

## Get current workout plan

### API name

Get active workout plan with days and exercises

### Function

Returns the newest **active** plan for the user. For **calendar-shaped** plans, returns a date-windowed subset of days (default: current week). For legacy **template-shaped** plans, returns all days with occurrences.

### Route

`GET /api/workout-plans/current`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Recommended header:** `x-timezone: <IANA timezone>`

**Query (optional, calendar plans only):**

| Param       | Default        | Description                          |
| ----------- | -------------- | ------------------------------------ |
| `startDate` | Monday of week | Start of date range (YYYY-MM-DD)     |
| `endDate`   | Sunday of week | End of date range (YYYY-MM-DD)       |

### Response format

**200 — Calendar plan:**

```json
{
  "workoutPlan": { "_id": "...", "planShape": "calendar", "..." : "..." },
  "days": [
    {
      "scheduledDateKey": "2026-03-30",
      "isRestDay": false,
      "name": "Push — Chest & Triceps",
      "status": "planned",
      "exercises": [],
      "..." : "..."
    }
  ],
  "window": {
    "timeZone": "America/New_York",
    "startDate": "2026-03-30",
    "endDate": "2026-04-05"
  }
}
```

**200 — Template plan (backward compat):**

```json
{
  "workoutPlan": { "_id": "...", "planShape": "template", "..." : "..." },
  "days": [],
  "occurrences": [],
  "occurrenceWindow": {
    "timeZone": "America/New_York",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD"
  }
}
```

Each day includes an `exercises` array with populated `exercise` documents (name, equipment, etc.).

**202** — No **active** plan yet, but a **`generating`** plan exists:

```json
{
  "message": "Your plan is being generated. Poll generation-status for progress.",
  "workoutPlanId": "<generatingPlanId>",
  "status": "generating"
}
```

**404** — No active plan and nothing in `generating` state.

**401** — Invalid token.

### Additional details

- Check `workoutPlan.planShape` to determine which response shape to expect.
- For calendar plans, use `startDate`/`endDate` query params to page through the **21-day** calendar window (defaults to the ISO week containing “today” in the resolved timezone).

---

## Photo refinement job status

### API name

Poll body-photo analysis / plan enhancement status

### Function

Returns analysis pipeline status for a given BodyPhotos document. When analysis completes, may include ids for the generated **photo_refinement** plan.

### Route

`GET /api/workout-plans/refinement-status/:bodyPhotosId`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `bodyPhotosId` — `_id` from `POST /api/body-photos` response.

### Response format

**200** — JSON:

```json
{
  "status": "pending",
  "error": null,
  "completedAt": null
}
```

`status` mirrors `bodyPhotos.analysisStatus` (e.g. `none`, `pending`, `processing`, `completed`, `failed` — treat missing as needed; stored values use `pending` | `processing` | `completed` | `failed` after job starts).

When `status` is **`completed`**, additional fields may appear:

```json
{
  "status": "completed",
  "error": null,
  "completedAt": "<ISO date>",
  "resultPlanId": "<ObjectId>",
  "resultPlanStatus": "active"
}
```

**404** — BodyPhotos not found or not owned by user.

**401** — Invalid token.

### Additional details

- **Recommended UX:** After `POST /api/body-photos`, poll every 2–5s until `completed` or `failed`.
- On success, navigate user to plan UI and call **`GET /api/workout-plans/current`**.

---

## Recommended flow: “Generate my enhanced plan” (photos)

1. User picks front + side images in the app.
2. **`GET /api/body-photos/upload-url`** twice (`imageType=front` and `side`) with JWT.
3. **`PUT`** each file to the returned `signedUrl`.
4. **`POST /api/body-photos`** with `frontImageUrl` + `sideImageUrl` = the **`publicUrl`** values from step 2.
5. Poll **`GET /api/workout-plans/refinement-status/:bodyPhotosId`** using `_id` from step 4.
6. On `completed`, **`GET /api/workout-plans/current`** for full plan + exercises.

---

## Workout calendar: list occurrences (per date)

### API name

List `WorkoutDayOccurrence` rows for the active plan in a date range

### Function

Returns scheduled instances keyed by `workoutDay` + `scheduledDateKey` with `status`: `planned` | `in_progress` | `completed` | `missed`. Use this (not template `WorkoutDay` alone) for week cards.

### Route

`GET /api/workout-plans/occurrences?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Query:** `startDate`, `endDate` — inclusive, lexicographic order works for ISO dates.

### Response format

**200** — JSON:

```json
{ "occurrences": [] }
```

**400** — Missing query params, or invalid `YYYY-MM-DD` format.

**404** — No active plan.

---

## Workout calendar: ensure occurrence rows

### API name

Ensure planned occurrences for a week (idempotent)

### Function

Creates missing `WorkoutDayOccurrence` documents with `planned` (or refreshes `missedAfterUtc` / `timeZone` when still `planned`).

### Route

`POST /api/workout-plans/occurrences/ensure`

### Payload

```json
{
  "slots": [
    {
      "workoutDayId": "<ObjectId>",
      "scheduledDateKey": "2026-03-28",
      "timeZone": "America/New_York"
    }
  ]
}
```

`timeZone` can be omitted per slot; backend falls back to `x-timezone` header, then saved `user.timeZone`, then `UTC`.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — `{ "occurrences": [ ... ] }`

**400/404** — Validation or workout day not on active plan.

---

## Reset template `WorkoutDay.status` (week boundary)

### API name

Reset all template days to `planned`

### Function

Sets every `WorkoutDay.status` on the **active** plan to `planned`. Call when starting a new training week so template rows do not stay `completed` / `missed` from the previous week.

### Route

`POST /api/workout-plans/current/reset-template-status`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — `{ "message": "...", "modifiedCount": 0 }`

**404** — No active plan.

---

## Start workout (from "Start" button)

### API name

Start workout session

### Function

Creates `WorkoutSession` (`in_progress`) and marks the workout day as `in_progress`. Runs a missed check first. Idempotent: if already `in_progress` with an open session, returns that session (`resumed: true`).

**Bootstraps tracking:** On new session creation, the backend automatically materializes `WorkoutSessionExercise` rows (one per planned exercise) so the frontend can immediately start tracking individual sets.

**Supports both plan shapes automatically** — the backend detects the plan shape from `workoutDayId`.

### Route

`POST /api/workout-sessions/start`

### Payload

```json
{
  "workoutDayId": "<ObjectId>",
  "scheduledDateKey": "2026-03-28"
}
```

| Field              | Required                    | Description                              |
| ------------------ | --------------------------- | ---------------------------------------- |
| `workoutDayId`     | yes                         | `_id` of the `WorkoutDay` to start       |
| `scheduledDateKey` | only for template-plan days | YYYY-MM-DD (ignored for calendar plans)  |
| `timeZone`         | no                          | IANA string in JSON body; optional query `?timeZone=` works too |

IANA timezone resolution order: `x-timezone` header → `timeZone` query → `timeZone` body → saved `user.timeZone` → `UTC`.

**Replacement workout differentiator (frontend rule):**

- When starting a replacement workout, pass:
  - `workoutDayId = _id` from `replacementWorkoutDay[]`
  - `scheduledDateKey = today's date` (`YYYY-MM-DD`)

Example:

```json
{
  "workoutDayId": "<replacementWorkoutDay._id>",
  "scheduledDateKey": "2026-03-31"
}
```

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**201** — New session (calendar): `{ "workoutSession", "workoutDay", "resumed": false }`

**201** — New session (template): `{ "workoutSession", "workoutDayOccurrence", "resumed": false }`

**200** — Resumed: same shape with `resumed: true`

**409** — Already completed or missed.

**404** — No active plan / invalid `workoutDayId`.

**400** — Cannot start a workout on a rest day (calendar plans).

---

## Complete workout

### API name

Complete workout session

### Function

Sets session `completed`. For **calendar plans**, updates `WorkoutDay.status` directly to `completed`. For **template plans**, updates the `WorkoutDayOccurrence` and mirrors to `WorkoutDay.status`.

### Route

`POST /api/workout-sessions/:sessionId/complete`

### Payload

Optional JSON:

| Field                  | Type                                 |
| ---------------------- | ------------------------------------ |
| `totalDurationMinutes` | number                               |
| `strenuousnessRating`  | `light` \| `moderate` \| `difficult` |
| `energyLevelRating`    | number 1–5                           |

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `sessionId` — from `workoutSession._id` on start.

### Response format

**200** — `{ "message": "Workout completed.", "workoutSession": { }, "progress": { } }`

`progress` contains the final tracking summary (see Get session progress below).

**404** — Session not found.

**409** — Session not `in_progress`.

**422** — Completion guard blocked (only when strict mode is enabled server-side; currently relaxed).

---

## Get session detail (with exercises + set logs)

### API name

Get full workout session tracking state

### Function

Returns the session, all bootstrapped exercises (with their planned prescription and exercise metadata), every recorded set log, and a computed progress summary. Use this to restore the "Track Workout" screen if the user navigates away and returns.

### Route

`GET /api/workout-sessions/:sessionId`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `sessionId` — from `workoutSession._id` on start.

### Response format

**200** — JSON:

```json
{
  "session": {
    "_id": "...",
    "status": "in_progress",
    "startedAt": "..."
  },
  "exercises": [
    {
      "_id": "<sessionExerciseId>",
      "workoutSession": "...",
      "workoutDayExercise": {
        "exercise": {
          "name": "Leg Extensions",
          "exerciseType": "strength",
          "videoUrl": "...",
          "thumbnailUrl": "..."
        },
        "prescribedSets": 3,
        "prescribedRepMin": 8,
        "prescribedRepMax": 12,
        "prescribedRestSeconds": 120,
        "specialInstructions": "Dropset last 2",
        "setType": "main"
      },
      "orderInSession": 1,
      "setLogs": [
        {
          "setNumber": 1,
          "recordedReps": 12,
          "recordedWeight": 156,
          "weightUnit": "lbs",
          "isCompleted": true,
          "loggedAt": "..."
        }
      ]
    }
  ],
  "progress": {
    "totalExercises": 8,
    "completedExercises": 2,
    "totalPrescribedSets": 26,
    "completedSets": 7,
    "percent": 27,
    "exercises": [
      {
        "sessionExerciseId": "...",
        "orderInSession": 1,
        "exerciseType": "strength",
        "prescribedSets": 3,
        "completedSets": 2,
        "done": false
      }
    ]
  }
}
```

**404** — Session not found.

---

## Upsert a set log (per-set tracking)

### API name

Track or update a single set during a workout

### Function

Upserts one `WorkoutSetLog` row identified by `(sessionExerciseId, setNumber)`. Idempotent — call on every checkbox tap or weight/rep change. Returns the saved log and an updated progress summary.

### Route

`PUT /api/workout-sessions/:sessionId/exercises/:sessionExerciseId/sets/:setNumber`

### Payload

**Strength / bodyweight:**

```json
{
  "recordedReps": 12,
  "recordedWeight": 156,
  "weightUnit": "lbs",
  "isCompleted": true
}
```

**Cardio:**

```json
{
  "recordedDurationMinutes": 30,
  "recordedSpeed": 4,
  "recordedIncline": 12,
  "isCompleted": true
}
```

All fields are optional on each call (partial update).

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

**Path:** `sessionId`, `sessionExerciseId` (from session detail), `setNumber` (1-based integer).

### Response format

**200** — JSON:

```json
{
  "setLog": {
    "workoutSessionExercise": "...",
    "setNumber": 1,
    "recordedReps": 12,
    "recordedWeight": 156,
    "weightUnit": "lbs",
    "isCompleted": true,
    "loggedAt": "..."
  },
  "progress": {
    "totalExercises": 8,
    "completedExercises": 2,
    "totalPrescribedSets": 26,
    "completedSets": 7,
    "percent": 27,
    "exercises": []
  }
}
```

**403** — Not your session.

**404** — Session exercise not found.

**409** — Session is not `in_progress`.

### Additional details

- Frontend should use optimistic UI updates, then fire this in background.
- Progress in the response powers the chip states at the top of the Track Workout screen.
- For cardio exercises, use `setNumber: 1` (always 1 prescribed set).

---

## Batch upsert set logs (sync burst)

### API name

Batch-sync multiple set logs at once

### Function

Upserts multiple set logs in one request. Useful for offline replay or periodic sync (e.g. every 5-10 seconds). Returns all saved logs and an updated progress summary.

### Route

`POST /api/workout-sessions/:sessionId/sets/batch`

### Payload

```json
{
  "sets": [
    {
      "sessionExerciseId": "<sessionExerciseId>",
      "setNumber": 1,
      "recordedReps": 12,
      "recordedWeight": 156,
      "weightUnit": "lbs",
      "isCompleted": true
    },
    {
      "sessionExerciseId": "<sessionExerciseId>",
      "setNumber": 2,
      "recordedReps": 10,
      "recordedWeight": 160,
      "weightUnit": "lbs",
      "isCompleted": true
    }
  ]
}
```

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — `{ "setLogs": [...], "progress": { ... } }`

**400** — Missing or empty `sets` array.

**409** — Session not `in_progress`.

---

## Get session progress (lightweight)

### API name

Get live progress summary for chip updates

### Function

Returns only the computed progress summary — no exercises or set logs. Use this for fast chip polling if you don't need the full session detail.

### Route

`GET /api/workout-sessions/:sessionId/progress`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — JSON:

```json
{
  "totalExercises": 8,
  "completedExercises": 5,
  "totalPrescribedSets": 26,
  "completedSets": 20,
  "percent": 77,
  "exercises": [
    {
      "sessionExerciseId": "...",
      "orderInSession": 1,
      "exerciseType": "strength",
      "prescribedSets": 3,
      "completedSets": 3,
      "done": true
    }
  ]
}
```

**404** — Session not found.

### Additional details

- `exercises[].done` drives the chip checkmark state.
- `exercises[].exerciseType` tells frontend whether to render reps/weight inputs or duration/speed/incline inputs.
- `percent` drives the overall progress bar.

---

## Recommended workout tracking flow

1. User taps **Start** on a workout card.
2. **`POST /api/workout-sessions/start`** — returns session + bootstrapped exercises.
3. **`GET /api/workout-sessions/:sessionId`** — load full detail with planned exercises, set prescriptions, and video URLs.
4. User works through exercises:
   - Each time they tap a set checkbox or edit reps/weight: **`PUT .../sets/:setNumber`** — returns updated progress for chip states.
   - Alternatively, batch-sync every 5-10s: **`POST .../sets/batch`**.
   - For cardio: track with `setNumber: 1`, send `recordedDurationMinutes`, `recordedSpeed`, `recordedIncline`.
5. After the last exercise, user taps **Complete Session**.
6. **`POST /api/workout-sessions/:sessionId/complete`** with optional `totalDurationMinutes`, `strenuousnessRating`, `energyLevelRating`.

---

## Run missed check (current user)

### API name

Apply missed rules for the authenticated user

### Function

Checks both plan shapes:
- **Calendar plans:** Any `WorkoutDay` with `scheduledDateKey` still `planned`/`in_progress` whose `missedAfterUtc` ≤ now → `missed`.
- **Template plans:** Same logic via `WorkoutDayOccurrence`.

Also runs automatically on start/complete and on a **15-minute** server interval.

### Route

`POST /api/workout-sessions/check-missed`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`.

### Response format

**200** — `{ "message": "Missed check applied.", "occurrenceUpdated": 0, "calendarDaysUpdated": 0 }`

---

## Home dashboard

### API name

Get home screen data (single-request aggregate)

### Function

Returns everything the home screen needs in one call: greeting metadata, streak, the 7-day week schedule with computed card states, today's nutrition summary, and active plan info. Also runs the missed-workout check opportunistically. Supports both **calendar** and **template** plan shapes.

### Route

`GET /api/home/dashboard?dateKey=YYYY-MM-DD`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`

**Recommended header:** `x-timezone: <IANA timezone>` (e.g. `America/New_York`)
On app open this header is checked and `user.timeZone` is updated if changed.

**Query params:**

| Param       | Example            | Description                                                        |
| ----------- | ------------------ | ------------------------------------------------------------------ |
| `dateKey`   | `2026-03-28`       | **Required.** Anchor date (YYYY-MM-DD) for the week strip (Mon–Sun week containing this date). |
| `timeZone`  | `America/New_York` | **Optional.** IANA zone if you cannot send `x-timezone`; must be valid IANA (same resolution order as other endpoints). |

### Response format

**200** — JSON:

```json
{
  "user": {
    "_id": "<ObjectId>",
    "name": "Jonas",
    "timeOfDay": "morning"
  },
  "hasPlan": true,
  "plan": {
    "_id": "<ObjectId>",
    "name": "My Workout Plan",
    "generationType": "initial",
    "planShape": "calendar"
  },
  "streak": { "current": 21 },
  "todayCard": { "dateKey": "2026-03-28", "cardState": "today_planned", "..." : "..." },
  "weekSchedule": [
    {
      "dateKey": "2026-03-23",
      "dayLabel": "mon",
      "cardState": "past_completed",
      "isRestDay": false,
      "workoutDay": { "_id": "...", "name": "Arms", "scheduledDateKey": "2026-03-23", "status": "completed" },
      "effectiveWorkoutDay": { "_id": "...", "name": "Arms" },
      "setsCompletedPercent": null
    },
    {
      "dateKey": "2026-03-24",
      "dayLabel": "tue",
      "cardState": "past_rest",
      "isRestDay": true,
      "workoutDay": { "_id": "...", "name": "Rest Day", "isRestDay": true },
      "effectiveWorkoutDay": null,
      "setsCompletedPercent": null
    }
  ],
  "todayNutrition": {
    "consumed": { "calories": 1200, "protein": 95, "carbs": 110, "fat": 42 },
    "mealCount": 3
  },
  "timeOfDay": "morning"
}
```

**`cardState` values** (8 UI card states):

| `cardState`         | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `today_planned`     | Today, training day, not started yet                      |
| `today_in_progress` | Today, training day, session started                      |
| `today_completed`   | Today, training day, finished                             |
| `today_rest`        | Today, rest day                                           |
| `past_completed`    | Past day, training day, finished                          |
| `past_missed`       | Past day, training day, deadline passed w/o completion     |
| `past_rest`         | Past day, rest day                                        |
| `future`            | Future date                                               |

**`plan.planShape`** — `"calendar"` for new **3-week** AI plans, `"template"` for legacy plans. For calendar plans, `workoutDay` is the `WorkoutDay` document directly (with `scheduledDateKey`, `isRestDay`, `status`). For template plans, `occurrence` is included instead.

**`effectiveWorkoutDay`** reflects any active **workout replacement**. If a replacement is set, `workoutDay` is the original scheduled day, `effectiveWorkoutDay` is the substitute.

**200 (no plan):**

```json
{
  "user": { "_id": "...", "name": "Jonas", "timeOfDay": "morning" },
  "hasPlan": false,
  "streak": { "current": 0 },
  "weekSchedule": [],
  "todayNutrition": { "consumed": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }, "mealCount": 0 }
}
```

**400** — Missing or invalid `dateKey`.

**401** — Invalid token.

### Additional details

- Call once on app foreground / home screen mount.
- Pass the device's current local date as `dateKey`.
- Pass device IANA timezone via `x-timezone` header on app open and subsequent calls.
- `weekSchedule` always returns **7 entries** (Mon–Sun of the week containing `dateKey`).
- For **calendar plans**, no separate occurrence mapping is needed — `WorkoutDay` records already have `scheduledDateKey` and `status`.
- For **template plans**, occurrences must already exist (via `POST /api/workout-plans/occurrences/ensure`) for cards to show workout states instead of defaulting to rest.

---

## Occurrence endpoints (template plans only)

The following endpoints are **only relevant for template-shaped plans** (`planShape: "template"`). Calendar-shaped plans do not use occurrences — each `WorkoutDay` already has a `scheduledDateKey` and `status`.

### List occurrences

`GET /api/workout-plans/occurrences?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

### Ensure occurrence rows

`POST /api/workout-plans/occurrences/ensure`

### Reset template status (week boundary)

`POST /api/workout-plans/current/reset-template-status`

See previous documentation for full payloads. These remain unchanged.

---

## Get workout replacement options (replacement sheet)

### API name

List workout replacements + sheet options with yesterday-completed exclusion

### Function

Returns persistent replacement rules AND the replacement-sheet option list. Supports both plan shapes. When `dateKey` is supplied, the response includes `sheetOptions` with each workout template in the plan, marking the one blocked by yesterday's completion as `disabled: true`.

### Route

`GET /api/home/workout-replacements?dateKey=YYYY-MM-DD`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`

**Query (optional):**

| Param     | Description                                         |
| --------- | --------------------------------------------------- |
| `dateKey` | Today's local date. Required for sheet options.     |

### Response format

**200** — JSON:

```json
{
  "replacements": [
    {
      "_id": "<replacementId>",
      "originalWorkoutDay": { "_id": "...", "name": "Back & Biceps", "dayNumber": 2 },
      "replacementWorkoutDay": { "_id": "...", "name": "Chest & Triceps", "dayNumber": 1 }
    }
  ],
  "sheetOptions": {
    "options": [
      { "_id": "...", "name": "Chest & Triceps", "dayNumber": 1, "exerciseCount": 11, "disabled": false, "disabledReason": null, "isScheduledToday": false },
      { "_id": "...", "name": "Back & Biceps", "dayNumber": 2, "exerciseCount": 10, "disabled": true, "disabledReason": "completed_yesterday", "isScheduledToday": false },
      { "_id": "...", "name": "Delts & Core", "dayNumber": 3, "exerciseCount": 10, "disabled": false, "disabledReason": null, "isScheduledToday": true }
    ],
    "blockedWorkoutDayId": "<workoutDayObjectId or null>",
    "isRestDay": false,
    "todayWorkoutDayId": "<workoutDayObjectId or null>"
  }
}
```

**`sheetOptions`** is only present when a valid `dateKey` query param is supplied. Each option row is a `WorkoutDay` (with `disabled` / `disabledReason` / `isScheduledToday` added for the sheet). `_id` is the real ObjectId string, not a synthetic `day1` label.

**Note:** `GET /api/home/workout-replacements` always loads **`replacements`** first; if the user has **no active plan**, the handler responds **404** before `sheetOptions` is computed (even when `dateKey` is omitted).

### Replacement sheet exclusion rules

| Scenario                                               | Blocked? |
| ------------------------------------------------------ | -------- |
| Yesterday workout completed                            | Yes — that workout day is `disabled`                          |
| Yesterday was rest day (no occurrence)                  | No — nothing blocked                                          |
| Yesterday workout missed / not completed                | No — nothing blocked                                          |
| Day-before-yesterday completed                          | No — only immediately previous day blocks                     |
| Yesterday had a replacement active and completed        | Yes — the **effective** (replacement) workout is blocked, not the original template |

**404** — No active plan.

**401** — Invalid token.

---

## Set (or update) a workout day replacement

### API name

Swap one workout day with another (persistent)

### Function

Replaces `originalWorkoutDay` with `replacementWorkoutDay` in the schedule. Wherever the original day appears, the replacement day's exercises are served instead. Calling again for the same `originalWorkoutDayId` overwrites the previous swap.

### Route

`POST /api/home/workout-replacements`

### Payload

JSON body:

| Field                     | Type     | Required |
| ------------------------- | -------- | -------- |
| `originalWorkoutDayId`    | ObjectId | yes      |
| `replacementWorkoutDayId` | ObjectId | yes      |

Both IDs must belong to the user's active plan. A day cannot replace itself.

```json
{
  "originalWorkoutDayId": "<Back day _id>",
  "replacementWorkoutDayId": "<Chest day _id>"
}
```

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`

### Response format

**200** — JSON:

```json
{
  "message": "Workout day replacement saved.",
  "replacement": {
    "_id": "<replacementId>",
    "originalWorkoutDay": { "_id": "...", "name": "Back & Biceps", "dayNumber": 2 },
    "replacementWorkoutDay": { "_id": "...", "name": "Chest & Triceps", "dayNumber": 1 }
  }
}
```

**400** — Missing fields, or trying to swap a day with itself.

**404** — Either day not found on active plan, or no active plan.

**401** — Invalid token.

### Additional details

- Replacements are **plan-scoped**: generating a new plan clears all old replacements (new plan = new day IDs).
- `GET /api/home/dashboard` reflects replacements via `effectiveWorkoutDay`.
- To revert, call `DELETE /api/home/workout-replacements/:replacementId`.
- For replacement session start requests from frontend, use `replacementWorkoutDay._id` in `workoutDayId` and send `scheduledDateKey` as today's local date.

---

## Remove a workout day replacement

### API name

Remove workout day replacement (revert to original)

### Function

Deletes one replacement rule. Day returns to its original template exercises on next dashboard load.

### Route

`DELETE /api/home/workout-replacements/:replacementId`

### Payload

None.

### Auth / headers / params

**Required:** `Authorization: Bearer <accessToken>`

**Path:** `replacementId` — `_id` from the replacement object.

### Response format

**200** — JSON:

```json
{ "message": "Replacement removed. Day restored to original." }
```

**404** — Replacement not found, or not owned by user.

**401** — Invalid token.

---

## Plan shape reference

| Property          | `"template"`                              | `"calendar"`                                  |
| ----------------- | ----------------------------------------- | --------------------------------------------- |
| `workoutPlan.planShape` | `"template"` (or absent on old plans) | `"calendar"`                                  |
| Days per plan     | N (workout days only)                     | **21** (3 weeks of calendar dates including rest days) |
| `WorkoutDay.scheduledDateKey` | `null`                          | `"YYYY-MM-DD"`                                |
| `WorkoutDay.isRestDay` | `false` (always)                     | `true` or `false`                             |
| Status source     | `WorkoutDayOccurrence`                    | `WorkoutDay.status` directly                  |
| Session start     | Requires `scheduledDateKey` in body       | Only needs `workoutDayId`                     |
| Missed logic      | Scans `WorkoutDayOccurrence.missedAfterUtc` | Scans `WorkoutDay.missedAfterUtc`           |
| Dashboard         | Reads occurrences for week                | Reads `WorkoutDay` by `scheduledDateKey` range |

---

## Global error shapes (reference)

| Situation            | Typical status | Body                                            |
| -------------------- | -------------- | ----------------------------------------------- |
| Mongoose validation  | 400            | `{ "message": "<joined field messages>" }`      |
| Invalid ObjectId     | 400            | `{ "message": "Invalid value for field: ..." }` |
| Duplicate unique key | 409            | `{ "message": "<field> is already in use." }`   |
| Unhandled error      | 500            | `{ "message": "<message>" }`                    |
| No matching route    | 404            | `{ "message": "Route not found" }`              |

---

_Synced with `src/server.js` mount paths and `src/routes/*.js` as of April 2026. If behavior diverges, `src/routes/`, `src/controllers/`, and `src/services/` are authoritative._
