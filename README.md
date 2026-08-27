# Draft Slot Geo Guessers

A deliberately ridiculous, mobile-first geography tournament that ranks league members, then lets them choose fantasy draft slots in that order. This is the draft-slot draft—not the fantasy draft.

Production: [draft.jc-sync.com](https://draft.jc-sync.com)

## How it works

- The commissioner configures 4–32 players (the intended league currently has 12), 60 viewing seconds, and three locations per matchup.
- Everyone claims a predetermined name with a browser-local token. There are no accounts or passwords.
- A recursive knockout/placement bracket creates an exact 1–N ranking. A 12-player tournament uses four play-ins, four byes, and 20 total matches including placement matches.
- Both players get the same unique panoramas and camera headings. Each location is no-move Street View followed by one permanent world-map guess.
- Server timestamps survive refreshes. Answers and all distances stay hidden until both players finish.
- Lowest aggregate Haversine distance wins. Ties compare each location in order; a still-exact tie goes to the lower precommitted random seed.
- Rank 1 chooses any draft slot, then rank 2, and so on. A Postgres function locks and advances this queue atomically.

## Local development

```bash
npm install
vercel env pull .env.local
npm run dev
```

The app runs at `http://localhost:3002` because port 3000 is already used on the development machine.

Useful checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

To enter `/admin`, copy the configured secret without printing it:

```bash
npm run admin-secret
```

## External services

Required Vercel variables:

```text
SUPABASE_URL                      server only
SUPABASE_SECRET_KEY               server only
ADMIN_SECRET                      server only
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY   browser safe, referrer restricted
```

Supabase migrations live in `supabase/migrations`. Apply them with `supabase db push` after linking the project.

The Google project needs billing and Maps JavaScript API enabled. The browser key should allow only the required API and these referrers:

```text
http://localhost:3002/*
https://draft.jc-sync.com/*
https://draft-slot-geo-guessers.vercel.app/*
```

The commissioner validates the curated worldwide candidate pool from `/admin`; this resolves each candidate to a real Google-owned Street View panorama before the tournament can start. The initial page never loads Google Maps.

## Recovery model

This is a private friends app, so recovery is intentionally manual. The admin screen can reset claims and broken attempts, force an unfinished matchup winner, undo the draft queue, or delete the current tournament while retaining validated locations. Destructive buttons require browser confirmation and actions are audited.
