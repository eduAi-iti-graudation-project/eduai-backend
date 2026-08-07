# Dashboard Insights — Frontend Handoff

> Backend half: Task 4 in `TASKS.md` (owner: Ahmed Selim). This file is the
> contract the backend implements against. **The backend decides what is
> shown, what chart type it is, and whether it's trending up or down — the
> frontend only renders what the backend declares.** Never compute trends,
> deltas, or chart types client-side.
>
> Chart library: **Recharts** (already in the frontend `package.json`).
> Last updated for the Task 4 DTOs.

---

## Endpoints

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /dashboard/insights?interval=week\|month` | TEACHER, STUDENT, GUARDIAN, ADMIN | Role-aware insight dashboard (default `interval=week`) |
| `GET /dashboard/insights/students/:id?interval=...` | TEACHER (own classes), GUARDIAN (own wards), ADMIN, STUDENT (self only) | Per-student drill-down, same shape as above |

Both return the same envelope (below). `interval=month` returns 12 monthly
buckets instead of 12 weekly ones. Invalid `interval` → `400`.

## Response envelope

```ts
interface InsightsResponse {
  interval: 'week' | 'month';
  sections: InsightSection[];   // ordered for the page layout
  agentInsights: AgentInsight[]; // narrative lists (cards), role-specific
  unreadNotifications: number;
}

interface InsightSection {
  key: string;            // stable id — see table below
  title: string;          // backend-written human-readable title
  chartType: 'line' | 'area' | 'bar' | 'radar' | 'donut';
  series: { label: string; value: number }[];
  delta?: {               // present on 'line'/'area' only
    deltaPercent: number; // e.g. 12.5 or -8.0 (signed)
    direction: 'up' | 'down' | 'flat';
  };
}
```

## Rendering rules (non-negotiable)

1. **Render by `chartType` only** — never guess a chart from the section
   key or data shape.
2. **Trend badge**: show only where `delta` exists (`line`/`area`). Render
   `delta.direction` — green `↑` for `up`, red `↓` for `down`, gray `→`
   for `flat` — with `deltaPercent` (e.g. `+12.5%` / `-8%`). No badge
   on `bar`/`radar`/`donut`.
3. **Empty state**: any section with `series.length === 0` renders its
   title + a "No data yet" placeholder — do not draw an empty chart.
4. **`bar` sections**: `series` is already sorted by the backend when order
   matters (e.g. per-teacher workload). Render labels as-is.
5. **`radar` sections**: each `series` item is one axis
   (`label` = criterion/axis name, `value` = avg %).
6. **`donut` sections**: each `series` item is one segment
   (`label` = category, `value` = count).
7. Refresh the page data with React Query; no polling loop needed for MVP.

## chartType → Recharts mapping

| chartType | Recharts component | Notes |
|---|---|---|
| `line` | `<LineChart>` | trend line; pair with the `delta` badge above the chart |
| `area` | `<AreaChart>` | same data as `line`; use for volume (submissions, alerts) |
| `bar` | `<BarChart>` | categorical comparison |
| `radar` | `<RadarChart>` | `PolarGrid` + `Radar`; `label` → `PolarAngleAxis`, `value` → `Radar dataKey` |
| `donut` | `<PieChart>` with `<Pie innerRadius={60} />` | legend from `label` |

One generic component per chartType (e.g. `TrendLineChart`, `TrendAreaChart`,
`ComparisonBarChart`, `StrengthRadarChart`, `DonutChart`) driven by
`InsightSection` — no per-dashboard chart components.

## Section keys per role

### TEACHER (`GET /dashboard/insights`)

| key | title (backend) | chartType | delta |
|---|---|---|---|
| `submissions_volume` | Submissions per week | `area` | yes |
| `confirmed_grades` | Grades confirmed per week | `line` | yes |
| `pending_confirmations` | Grades awaiting review per week | `line` | yes |
| `alerts_created` | Alerts created per week | `area` | yes |
| `alerts_resolved` | Alerts resolved per week | `area` | yes |
| `attendance_rate` | Attendance rate per week | `line` | yes |
| `class_average` | Average score per class | `bar` | no |
| `criterion_average` | Average score per criterion | `radar` | no |
| `struggling_students` | Homework-helper redirects per student | `bar` | no |

`agentInsights` (cards):
- Latest `StudentAnalysis.teacherContent` per flagged student (name +
  short text).
- Latest `StudentReport.teacherSection` per student with a report.
- Recent `HOMEWORK_HELP_REDIRECT` entries (student name + question).

### STUDENT

| key | title | chartType | delta |
|---|---|---|---|
| `grade_trend` | My grades over time | `line` | yes |
| `attendance_trend` | My attendance per week | `line` | yes |
| `criterion_strengths` | Strengths by criterion | `radar` | no |
| `help_action_split` | Homework-helper outcomes | `donut` | no |

`agentInsights`: active alerts (type + reason), latest own report summary.

### GUARDIAN

One `agentInsights` card and three sections **per child** — keys are
namespaced with the child id:

| key | title | chartType | delta |
|---|---|---|---|
| `child_<id>_grades` | <child> grades over time | `line` | yes |
| `child_<id>_attendance` | <child> attendance per week | `line` | yes |
| `child_<id>_alerts` | <child> alerts created per week | `area` | yes |

`agentInsights`: per child — `StudentReport.parentSection` +
`StudentAnalysis.guardianContent`.

### ADMIN

| key | title | chartType | delta |
|---|---|---|---|
| `submissions_volume` | Submissions per week (school) | `area` | yes |
| `confirmed_grades` | Grades confirmed per week | `line` | yes |
| `pass_rate_trend` | Pass rate per week | `line` | yes |
| `alerts_created` | Alerts created per week | `area` | yes |
| `user_growth` | Students & teachers per bucket | `bar` | no |
| `teacher_workload` | Pending reviews per teacher | `bar` | no |
| `alert_status_split` | Alert status distribution | `donut` | no |

`agentInsights`: latest `StudentReport.managementSummary` per recent report;
per-teacher summary (average, pending reviews, student count).

## Data rules to be aware of

- **Confirmed only**: every grade-based number comes exclusively from
  `isConfirmed = true` rows — students never see AI suggestions.
- **Drill-down**: navigating to a student's insight page calls
  `GET /dashboard/insights/students/:id`; expect `403` if the caller has no
  access (route to an error state).
- **Deltas are computed server-side** (current 12-bucket window vs the
  previous window of the same length).
