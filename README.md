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
- three-bvh-csg for real boolean mesh subtraction (holes) in a Web Worker;
  straight through-holes are cut in 2D instead (`cutPlan.ts`), and every
  finished cut is kept in IndexedDB (`csgCache.ts`, 200 MB, oldest out) so
  a shape is cut once per device
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
    auth/          Supabase auth store, sign-in dialog, user menu, guest gate
    community/     publish dialog + community cards
    assets/        asset library panel
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
`community_items` tables, an `avatars` storage bucket, and the `account`
Edge Function (deletes a user, which needs the service role). Without the
Supabase env vars the app still works in guest mode (no sign-in, no sync,
no community).

1. **Create a project** at https://supabase.com/dashboard (free tier).
2. **Run the schema**: open SQL Editor and run `supabase/schema.sql`. It
   creates `projects` (row-level security per user), `profiles` (display name, avatar, role:
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
5. **Deploy the functions**: either `npx supabase functions deploy --project-ref <ref>`
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

Home: a Figma-style sidebar (account, search, Recents, Community, then
your Projects and Collections, Admin for staff). Community models can be
liked, commented on and saved into collections (`community_likes`,
`community_comments`, `collections` + `collection_items`; counters on the
item row are kept by triggers). A collection is private unless its owner
makes it public, which makes it shareable by link.

Home & community: the sidebar's Home page shows your newest projects,
what the people you follow published, new community models and your
collections. `/community` is an overview (new models, popular models,
public collections) with full pages at `/community/models` and
`/community/collections`. `/search?q=` looks across your projects,
community models, public collections and people. `/u/<id>` is a public
profile (models, public collections, level, bio, follow button); the
`follows` table notifies followers when someone they follow gets a model
approved.

Moderation: every new community model and collection from a regular user
waits in the admin's Approvals tab (`approval` column: pending / approved /
rejected; moderators and admins skip the queue). Approvals, rejections
(with a note), replies, @mentions, comments on your models, new versions
of your models and level-ups land in the `notifications` table and the
bell in the sidebar. Email delivery is not wired yet.

Versions: authors publish new versions of their own models from the
project menu ("Community listing" → "Publish as a new version", or a copy
of your own model published "as a version"): `publish_item_version`
archives the current model into `community_item_versions` and replaces
it on the same listing, so likes, comments and downloads stay and the
community list shows one entry. A project opened from someone else's
model remembers its source; publishing it "as a version of …" creates a
separate item with `parent_id` (and `root_id`, set by trigger). Each model
page lists everything under Versions: the author's archived versions,
the current one and the models published from copies, with date,
printer, plate count, the change note and a direct 3MF download each. Authors get "Edit the original" and
"Continue as a copy" on their own models; everyone gets "Print it as
is": a direct 3MF (with the chosen printer's plate size, every plate and
the author's print settings as metadata) or STL, without creating a
project.

Plates: a project has up to 5 build plates (`plates` in the document,
`plateId` on each shape; shapes without one sit on the first plate). A
Plates list above the layers (compact tabs floating over the canvas when
that panel is hidden) switches, adds, renames (double-click) and deletes
plates; deleting a plate moves its shapes to the nearest plate.
Plates sit in a fixed grid by creation order (`plateLayout.ts`, Bambu
Studio's spacing): the 2D canvas draws the other plates dimmed around the
active one (click one to switch, drag a shape onto one to move it there),
the layers list, print preview and warnings show the active plate only,
and "All plates" draws the others beside it in 3D with their beds faded.
Exports are named after the project; a 3MF is written as a Bambu Studio
project (generator tag, printer / print / filament preset names in
`Metadata/project_settings.config`), which is what makes Bambu Studio
open it with its plates and settings instead of as loose geometry — use
"Open project", not "Import". The 2D artboard colour is a document
setting (Artboard section when nothing is selected).

Profile: a solid's width along its height (`profile` on the layer:
rings of height + scale, smooth or straight between them) — a vase, a
cone, a barrel. The 3D tab's "Shape along the height" section has
silhouette presets, a ring list
and "Ruler in 3D": a ruler beside the shape where rings are dragged up
and down for height and in and out for width, and a click adds a ring.
The body is tessellated and scaled per height (`profile.ts`); the shell
cavity and the perforation cutters follow the same curve. Parts leaning
out past 45° are flagged on the ruler and in the panel.

The right panel is tabbed: Design / 3D / Effects for a selection (shell
and profile under 3D; pocket, texture, perforation and carve under
Effects), Printer / Print for the document. Switching the editor to
3D-only view brings the 3D tab up. Copy, cut and paste
(⌘C/⌘X/⌘V, also in the right-click menu) work across plates and from the
2D canvas, the 3D view and the layer list alike. A shape larger than the bed offers "Split across plates", which
cuts it into bed-sized pieces, one per plate. A 3MF export carries every
plate as Bambu Studio plates (same 1.2 × bed stride and grid layout as
Bambu Studio, `<plate>` blocks in `Metadata/model_settings.config`); an STL
holds the active plate.

Levels: `profiles.xp` / `profiles.level` (level L needs 50·L·(L−1) XP).
Publishing, approvals, likes, opened copies, comments and collections
earn XP; the account page shows the bar.

Community: "Publish to community…" in a project's menu stores a *copy* of
the project with a title, description, print notes and tags; the same menu
entry later edits the listing or replaces the shared model with the
current project. `/community` lists and searches shared models, `/c/<id>`
shows one and opens a copy into your projects. Authors can hide or remove
their own items.

Roles: `profiles.role` is `user`, `moderator` or `admin`. Staff get an
Admin entry in the user menu (`/admin`: overview numbers, community
moderation with feature / hide / remove, user list);
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
