# Census Server — Data Guide

## Where is the data on the VPS?

```
/opt/census-server/
├── data/
│   ├── census.db          ← THE DATABASE (SQLite file, ~72 KB empty, grows with data)
│   └── users.json         ← Source user list (only used by seed script)
├── src/                   ← Server code (never modified at runtime)
│   ├── index.js           ← Express entry point
│   ├── config.js          ← Reads .env
│   ├── db/
│   │   ├── connection.js  ← Opens census.db, runs schema
│   │   ├── schema.sql     ← Table definitions
│   │   └── seed.js        ← Imports users.json → database
│   ├── middleware/
│   │   └── auth.js        ← JWT token verification
│   ├── routes/            ← API endpoints
│   └── services/          ← Business logic
├── .env                   ← PORT, JWT_SECRET, DB_PATH
├── package.json
└── node_modules/
```

**Only one file matters at runtime: `data/census.db`**
Everything else is code. Back up `census.db` and you've backed up all data.

---

## The Database: 6 Tables

### 1. `users` — 55 rows (read-only after seed)

The 55 users come from `users.json` and form a 3-level hierarchy:

```
                    8A (Admin)
                 Administrateur National
                         │
        ┌────┬────┬────┬─┴──┬────┬────┬────┬────┐
       8AA  8AB  8AC  8AD  8AE  8AF  8AG  8AH  8AI
       EST  HO   MO   NG   NY   OI   OL   OM   WN
        │    │    │    │    │    │    │    │    │
       5×   5×   5×   5×   5×   5×   5×   5×   5×
     agents agents ...                        agents
```

| Role | Count | Login Pattern | Description |
|------|-------|---------------|-------------|
| admin | 1 | `8A` | Sees everything, manages all supervisors |
| supervisor | 9 | `8AA`–`8AI` | One per province (9 provinces of Gabon) |
| agent | 45 | `8AAA`–`8AIE` | 5 per supervisor, do fieldwork |
| **Total** | **55** | | |

**Why 55?** = 1 admin + 9 supervisors + (9 × 5 agents) = 55

Each supervisor covers one province:

| Login | Province | # Pre-assigned SD regions |
|-------|----------|---------------------------|
| 8AA | Estuaire | 1,875 |
| 8AB | Haut-Ogooué | 297 |
| 8AC | Moyen-Ogooué | 119 |
| 8AD | Ngounié | 198 |
| 8AE | Nyanga | 71 |
| 8AF | Ogooué-Ivindo | 99 |
| 8AG | Ogooué-Lolo | 96 |
| 8AH | Ogooué-Maritime | 331 |
| 8AI | Woleu-Ntem | 206 |

Agents start with **0 regions** — supervisors assign SD codes to them at runtime.

**Columns:**
| Column | Type | Example |
|--------|------|---------|
| login | TEXT (PK) | `8AAA` |
| password | TEXT | `mXu3ErXj` |
| role | TEXT | `agent` / `supervisor` / `admin` |
| name | TEXT | `Agent 8AAA` |
| parent | TEXT | `8AA` (supervisor's login) |
| province | TEXT | `01` |
| province_name | TEXT | `Estuaire` |
| regions | JSON | `["0101010010","0101010020",...]` |
| children | JSON | `["8AAA","8AAB",...]` (supervisors only) |

---

### 2. `habitations` — The core census data

Every time an agent fills out a form on their phone and syncs, a row appears here.

**Columns:**
| Column | Type | Example |
|--------|------|---------|
| id | TEXT (PK) | `010101001000101` (ilotCode + building + local) |
| ilot_code | TEXT | `0101010010` |
| sd_code | TEXT | `0101010010` (links to assignments) |
| building_number | TEXT | `001` |
| local_number | TEXT | `01` |
| form_data | JSON | `{"VC16A":"1","name":"Dupont",...}` |
| coordinates | JSON | `{"lat":0.39,"lng":9.45}` |
| status | TEXT | `pending` / `completed` |
| created_by | TEXT | `8AAA` (the agent's login) |
| created_at | TEXT | `2026-02-27T12:00:00.000Z` |
| updated_at | TEXT | `2026-02-27T12:05:00.000Z` |

**`form_data`** is a JSON blob containing all the census form fields. Key field:
- `VC16A`: `"1"` = numéroté, `"2"` = recensé, other = non visité

**`created_by`** is how we know **who** collected each record. This never changes.

---

### 3. `assignments` — Who works where

Maps SD codes (geographic zones) to agents. Created when a supervisor assigns SDs via the app.

**Columns:**
| Column | Type | Example |
|--------|------|---------|
| sd_code | TEXT (PK) | `0101010010` |
| operator_login | TEXT | `8AAA` |
| assigned_by | TEXT | `8AA` |
| assigned_at | TEXT | `2026-02-27T10:00:00Z` |

**One SD = one agent.** If reassigned, the previous assignment is replaced.

This table controls **what data each user can pull**:
- Agent pulls habitations from their assigned SDs only
- Supervisor pulls habitations from all SDs assigned to their agents
- Admin pulls everything

---

### 4. `sync_log` — Sync history

Every push/pull creates a row. Useful for debugging and auditing.

| Column | Type | Example |
|--------|------|---------|
| id | INTEGER (auto) | 1 |
| login | TEXT | `8AAA` |
| direction | TEXT | `push` or `pull` |
| records_count | INTEGER | 12 |
| status | TEXT | `success` / `error` |
| started_at | TEXT | `2026-02-27T12:00:00Z` |
| completed_at | TEXT | `2026-02-27T12:00:01Z` |

---

### 5. `activity_log` — Detailed audit trail

Every habitation create/update and assignment action is logged.

| Column | Type | Example |
|--------|------|---------|
| id | INTEGER (auto) | 1 |
| login | TEXT | `8AAA` |
| action | TEXT | `create_habitation` / `update_habitation` / `assign_sd` |
| target_id | TEXT | `010101001000101` (habitation ID or SD code) |
| details | JSON | `{"operator":"8AAA"}` |
| created_at | TEXT | `2026-02-27T12:00:00Z` |

---

### 6. `config` — Key-value settings

| key | value |
|-----|-------|
| `master_password` | `MASTER2024` |

---

## Data Flow: What happens during sync

```
┌─────────────┐                    ┌─────────────────┐
│  Phone App  │                    │  VPS Server     │
│  (jsonDB)   │                    │  (census.db)    │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. POST /api/auth/login           │
       │  ─────────────────────────────►    │
       │  { login, password }               │
       │  ◄─────────────────────────────    │
       │  { token, user profile }           │
       │                                    │
       │  2. POST /api/sync/8AAA (PUSH)     │
       │  ─────────────────────────────►    │
       │  { habitations: [...],             │
       │    assignments: [...] }            │
       │                                    │ → INSERT/UPDATE habitations
       │                                    │ → INSERT/UPDATE assignments
       │                                    │ → Log to sync_log + activity_log
       │  ◄─────────────────────────────    │
       │  { accepted: 5, conflicts: 0 }    │
       │                                    │
       │  3. GET /api/sync/8AAA (PULL)      │
       │  ─────────────────────────────►    │
       │                                    │ → Find agent's assigned SDs
       │                                    │ → Query habitations for those SDs
       │  ◄─────────────────────────────    │
       │  { habitations: [...],             │
       │    assignments: [...],             │
       │    counters: {...} }               │
       │                                    │
       │  → Merge into local jsonDB         │
       └────────────────────────────────────┘
```

## Data visibility (who sees what)

| Role | Push | Pull |
|------|------|------|
| **Admin (8A)** | Can push anything | Pulls ALL habitations + ALL assignments |
| **Supervisor (8AA)** | Pushes their agents' data | Pulls habitations from their agents' assigned SDs |
| **Agent (8AAA)** | Pushes only their own habitations | Pulls only habitations in their assigned SDs |

The `created_by` field on habitations is set by the phone app and **never changes on the server**. This is how we always know who collected each record, even after sync.

## Conflict resolution

Since each SD is assigned to exactly one agent, conflicts are rare. When they happen:
- **Server-wins with timestamp guard**: if the client's timestamp >= server's `updated_at`, the update is accepted. Otherwise it's marked as a conflict.
- Conflicts are counted in the push response but data is not lost — the server version is kept.

## Backup

The entire database is one file: `data/census.db`

```bash
# Daily backup (add to crontab)
cp /opt/census-server/data/census.db /opt/census-server/data/backup-$(date +%Y%m%d).db
```
