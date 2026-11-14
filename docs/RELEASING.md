# Releasing PrivMeet

A release is one annotated tag. Pushing it builds the Docker images, builds the four
installers and publishes a GitHub release with them attached.

**A person pushes the tag.** Agents and CI never push tags or open releases.

## 1. Bump the version

The same version string lives in five files. They must agree, or the installers, the About
dialog and the release disagree.

| File | Field |
|---|---|
| `frontend/package.json` | `"version"` |
| `desktop/package.json` | `"version"` |
| `desktop/src-tauri/tauri.conf.json` | `"version"` |
| `desktop/src-tauri/Cargo.toml` | `version` under `[package]` |
| `packaging/arch/PKGBUILD` | `pkgver`, with `pkgrel=1` |

`desktop/src-tauri/Cargo.lock` picks the new number up on the next `cargo build`; commit it
with the rest.

Semantic versioning: a new feature is `MINOR`, a fix is `PATCH`, a change that breaks an
existing install or the API is `MAJOR`.

## 2. Update the changelog

`CHANGELOG.md` follows Keep a Changelog. Move the entries out of `## [Unreleased]` into a
new section and leave a fresh empty `Unreleased` above it:

```md
## [Unreleased]

## [0.2.0] - 2026-11-13
### Added
- ...
```

Only list what a user would notice. Internal refactors belong in the commit log.

## 3. Check it locally

Work on a clean tree, on `main`, up to date with `origin`. The tag names the commit you are
looking at, so do not tag a dirty tree.

```sh
cd frontend && npm ci && npm run build && cd ..
cd backend && SECRET_KEY=check DEBUG=1 python manage.py check \
  && SECRET_KEY=check DEBUG=1 python manage.py makemigrations --check --dry-run && cd ..
SECRET_KEY=check docker compose config -q          # the stack still resolves
bash -n scripts/privmeet.sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color \
  .github/workflows/ci.yml .github/workflows/docker.yml .github/workflows/build-installers.yml
```

A local `docker compose build` and one processed meeting are worth the time before a
`MINOR` release, since the image is what users pull.

## 4. Tag and push

```sh
git tag -a v0.2.0 -m "PrivMeet 0.2.0"
git push origin v0.2.0
```

An annotated tag, not a lightweight one. Once it is public, treat it as immutable: do not
move it, force-push it or delete it. The image and the installers that users downloaded
would no longer match the tag.

A pre-release uses a suffix, `v0.2.0-rc1`. That publishes the image tag `0.2.0-rc1` only;
`:latest` is moved by real releases alone, so nobody following `latest` is pulled onto a
candidate by accident.

## 5. What the tag starts

| Workflow | On a `v*` tag | Result |
|---|---|---|
| `ci.yml` | runs like any push | Django check, migration drift, frontend build |
| `docker.yml` | builds and pushes | `ghcr.io/kashish1809/privmeet:<version>`, `:latest` (real releases only) and `<version>-gpu` |
| `build-installers.yml` | builds on real runners | Linux `.deb` + `.AppImage`, Windows `.msi` + `.exe` (NSIS), then the release job attaches all four |

The release job refuses to publish when the tag and `tauri.conf.json` disagree, which is
the check that catches a half-done version bump. It does not write release notes: edit the
published release and paste the changelog section in.

**Build installers** can also be started by hand with `workflow_dispatch`. That builds the
four installers and uploads them as artifacts without publishing a release, which is the
cheap way to check the packaging before a tag.

The first time an image is published, open the repo's **Packages** settings and make the
package public. A package created by `GITHUB_TOKEN` starts private, and neither
`docker compose` nor the desktop app can pull it without a `docker login`.

## 6. After the release

1. Open the Actions run and both jobs must be green. Download the `privmeet-linux` and
   `privmeet-windows` artifacts and check the four file names.
2. Install what you can: the `.deb` or AppImage on Linux, the `.msi` on Windows. Start it,
   let it bring the stack up, process one short file, quit.
3. Point the Arch package at the new `.deb`:

   ```sh
   cd packaging/arch
   curl -LO https://github.com/vinayakkam/privmeet/releases/download/v0.2.0/PrivMeet_0.2.0_amd64.deb
   sha256sum PrivMeet_0.2.0_amd64.deb
   ```

   Put the sum in `sha256sums`, bump `pkgver`, commit, then `makepkg -si`. The checksum is
   `SKIP` until this step, and must never stay that way in a published commit.
4. Check that a fresh install pulls the release and not a cached image:

   ```sh
   PRIVMEET_VERSION=0.2.0 docker compose up -d
   curl -s http://127.0.0.1:8000/api/system/
   ```

5. Update the README or `docs/` if a command changed in this release.

## Re-running a failed build

- A red job: use **Re-run failed jobs** on the Actions run. The tag does not change.
- A failed release job after the installers were built: the artifacts are gone with the
  run, so re-run the whole workflow with `workflow_dispatch` and re-tag nothing. If the
  release already exists with assets, delete the release (or its assets) first; the release
  step fails on an asset name that is already there.
- The Docker image is unaffected by installer failures and does not need rebuilding.

## Shipping a fix

Fix on `main`, bump `PATCH`, tag again. Never rebuild and republish an existing tag: the
image digest and the installers would change under users who already downloaded them.
