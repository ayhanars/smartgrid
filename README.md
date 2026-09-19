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
- Claude (Anthropic API) design assistant, proxied through a Supabase Edge
  Function so the API key never reaches the browser (`supabase/functions/claude`)
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
    auth/          Supabase auth store, sign-in dialog, user menu
    assistant/     Claude chat panel + streaming client for the Edge Function
  lib/
    geometry/      bevel/CSG/polygon-boolean helpers
    supabase/      Supabase client + cloud project data access
    persistence/   localStorage projects + cloud sync helpers
    units/         mm/cm/in conversion
  state/           shared zustand stores
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

## Cloud setup (Supabase, free tier)

Everything server-side runs on one free Supabase project: sign-in (email +
password, or Google), the `projects`, `profiles`, `user_assets` and
`community_items` tables, an `avatars` storage bucket, and two Edge
Functions: `claude` (fronts the Anthropic API) and `account` (deletes a
user, which needs the service role). Without the Supabase env vars the app
still works in guest mode (no sign-in, no sync, no assistant, no
community).

1. **Create a project** at https://supabase.com/dashboard (free tier).
2. **Run the schema**: open SQL Editor and run `supabase/schema.sql`. It
   creates `projects` (row-level security per user), `assistant_usage` (a
   per-user daily token ledger), `profiles` (display name, avatar, role:
   `user` / `moderator` / `admin`, created by a trigger on sign-up) and the
   public `avatars` bucket. Emails listed in `bootstrap_admins` become
   admins when they sign up; edit that insert before running it.
3. **Auth URLs**: Authentication → URL Configuration. Set *Site URL* to
   where the app is served (`https://<you>.github.io/smartgrid/`, or your
   domain) and add the same URL, plus `http://localhost:5173/smartgrid/`
   for local dev, under *Redirect URLs*. Enable Google under *Providers* if
   you want it (needs a Google OAuth client id/secret).
4. **Frontend env**: copy Project URL and anon key from Settings → API into
   `.env.local` (dev) and into the repo's Actions secrets
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (deploys).
5. **Assistant secrets** (Edge Functions → Secrets, or the CLI):
   `ANTHROPIC_API_KEY` from https://console.anthropic.com/settings/keys.
   Optional: `ASSISTANT_DAILY_TOKENS` (output tokens per user per UTC day,
   default 40000) and `ASSISTANT_MODEL` (default `claude-opus-5`).
6. **Deploy the functions**: either `npx supabase functions deploy --project-ref <ref>`
   locally after `npx supabase login`, or add the repo secrets
   `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` so
   `.github/workflows/supabase-functions.yml` deploys them on push.

Accounts: email sign-up needs a confirmation click (Supabase's default
mailer allows a couple of emails per hour, so add your own SMTP under
Authentication → SMTP before inviting real users). Existing magic-link users
set a password through "Forgot password?". The `/account` page handles
avatar, name, email, password, sign-out and account deletion.

How sync works: projects always autosave to the browser. While signed in
they also autosave to the cloud a couple of seconds later, and the home
page lists cloud-only projects so you can open them on another device.
Deleting a project removes both copies. Offline, the editor keeps saving
locally, says so in the top bar, and uploads when the connection is back;
project cards flag anything not yet in the cloud. "My assets" (shapes saved
from a selection or a layer's "Save as asset") sync the same way.

Community: "Publish to community…" in a project's menu stores a *copy* of
the project with a title, description, print notes and tags; the same menu
entry later edits the listing or replaces the shared model with the
current project. `/community` lists and searches shared models, `/c/<id>`
shows one and opens a copy into your projects. Authors can hide or remove
their own items.

Roles: `profiles.role` is `user`, `moderator` or `admin`. Staff get an
Admin entry in the user menu (`/admin`: overview numbers, community
moderation with feature / hide / remove, user list, assistant usage);
admins also change roles there and can delete removed items for good. The
first admin comes from `bootstrap_admins` in the schema; promote others
from the Users tab.

## Custom domain

Point the domain at GitHub Pages (Settings → Pages → Custom domain; add a
`public/CNAME` file so deploys keep it), set the repo variable/secret
`VITE_BASE=/` so the build stops assuming the `/smartgrid/` sub-path, and
update the Supabase auth URLs above.

## Known issue carried over from the original app

The bevel geometry-safety system (clamps top/bottom bevel to what's safe for
a shape's geometry) is solid for single-region shapes but can still produce
a broken cap on a multi-region shape with holes packed close together and a
large bevel. This needs a proper fix here rather than being re-inherited as-is.
