# smartgrid

A ground-up rebuild of the SVG → 3D print design tool (previously
`svg3d-designer` in [ayhanars/Ascensor.js](https://github.com/ayhanars/Ascensor.js)),
as its own project with new architecture and UI. The original app is untouched
and keeps running as-is; this is a separate, independent codebase.

A Figma-style 2D vector editor for drawing/importing SVG shapes, paired with a
live 3D preview that extrudes those shapes into printable models (STL / 3MF).

## Status

Early scaffold. Core libraries are wired in but the 2D canvas, 3D viewport,
and full feature set from the original app have not been rebuilt yet — UI
layout is intentionally on hold pending a layout benchmark.

## Stack

- React + TypeScript + Vite
- zustand + zundo for state and undo/redo
- Three.js, @react-three/fiber, @react-three/drei for 3D rendering
- three-bvh-csg for real boolean mesh subtraction (holes)
- polygon-clipping for 2D boolean ops (union/subtract/intersect/exclude)
- Supabase for auth + cloud project storage (see `supabase/schema.sql`)
- Deployed to GitHub Pages via GitHub Actions on push to `main`

## Project structure

```
src/
  features/
    canvas-2d/     2D vector editor (shapes, pen tool, selection, etc.)
    viewport-3d/   3D preview/export scene
    inspector/     per-shape geometry controls
    layers/        layer tree panel
    export/        STL / 3MF export
    auth/          Supabase auth store
  lib/
    geometry/      bevel/CSG/polygon-boolean helpers
    supabase/      Supabase client + data access
    units/         mm/cm/in conversion
  state/           shared zustand stores
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

## Cloud storage setup

Create a Supabase project (free tier), then run `supabase/schema.sql` in its
SQL editor to create the `projects` table with row-level security scoped to
each signed-in user.

For deploys, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repo
secrets (Settings → Secrets and variables → Actions) so the GitHub Actions
build step can inject them.

## Known issue carried over from the original app

The bevel geometry-safety system (clamps top/bottom bevel to what's safe for
a shape's geometry) is solid for single-region shapes but can still produce
a broken cap on a multi-region shape with holes packed close together and a
large bevel. This needs a proper fix here rather than being re-inherited as-is.
