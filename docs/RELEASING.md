# Releasing PrivMeet

A release is a version tag `vX.Y.Z` on `main`. When the tag is pushed, CI builds and publishes everything:

| Workflow | What it makes |
|---|---|
| `.github/workflows/docker.yml` | `ghcr.io/kashish1809/privmeet:X.Y.Z` (CPU) and `:X.Y.Z-gpu` (CUDA); `:latest` only for a real release, not a pre-release such as `v0.2.0-rc1` |
| `.github/workflows/build-installers.yml` | Windows NSIS `.exe` and `.msi`, Linux `.deb` and `.AppImage`, attached to a GitHub release |
| `.github/workflows/ci.yml` | the checks on every push, which must be green before you tag |

> **Agents never push.** The person releasing pushes the tag. Everything before the push can be prepared by anyone.

## 1. Pick the version
Use [Semantic Versioning](https://semver.org/):
- **Patch** (`0.1.1`): fixes only.
- **Minor** (`0.2.0`): new features. Old data and settings still work.
- **Major** (`1.0.0`): something users must act on, such as a data migration they must run, or a changed setting.

For a test run use a pre-release tag such as `v0.2.0-rc1`. It builds everything but does not move `:latest`.

## 2. Bump the version in four files
They must all match, or the installers and the About box disagree.

| File | Field |
|---|---|
| `desktop/package.json` | `"version"` |
| `desktop/src-tauri/tauri.conf.json` | `"version"` |
| `desktop/src-tauri/Cargo.toml` | `version =` under `[package]` |
| `frontend/package.json` | `"version"` |

Then refresh the lock files so CI's `npm ci` and `cargo` agree with them:
```
cd desktop && npm install --package-lock-only
cd ../frontend && npm install --package-lock-only
cd ../desktop/src-tauri && cargo update -p privmeet --precise X.Y.Z   # or any cargo build
```

## 3. Update the changelog
In `CHANGELOG.md`:
1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`.
2. Add a fresh empty `## [Unreleased]` above it.
3. Keep the Added, Changed and Fixed headings, and write for users, not for the team.

## 4. Commit, merge, tag
```
git checkout -b release/vX.Y.Z
git add desktop/package.json desktop/package-lock.json desktop/src-tauri/tauri.conf.json \
        desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock \
        frontend/package.json frontend/package-lock.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
```
Open a pull request, wait for CI, and merge it. Then tag the merge commit on `main`:
```
git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "PrivMeet X.Y.Z"
git push origin vX.Y.Z          # the person releasing does this
```

## 5. Check what CI made
1. **Actions tab:** `Docker image` and `Build installers` both green for the tag.
2. **Packages:** `ghcr.io/kashish1809/privmeet` has `X.Y.Z` and `X.Y.Z-gpu`, plus `latest` for a real release.
3. **Releases:** the release for `vX.Y.Z` lists `PrivMeet_X.Y.Z_x64-setup.exe`, `PrivMeet_X.Y.Z_x64_en-US.msi`, `PrivMeet_X.Y.Z_amd64.deb` and `PrivMeet_X.Y.Z_amd64.AppImage`.
4. **Smoke test:**
   - Install one installer and start it. The launcher pulls `X.Y.Z` and opens the app.
   - Or run `scripts/privmeet.sh update` then `up` (on Windows, `.\scripts\privmeet.ps1 update` then `up`) with `PRIVMEET_VERSION=X.Y.Z` in `.env`.

## 6. Update the Arch package
`packaging/arch/PKGBUILD` installs the released `.deb`.
1. Set `pkgver=X.Y.Z` and `pkgrel=1`.
2. Download the `.deb` from the release and put its checksum in `sha256sums`:
   ```
   sha256sum PrivMeet_X.Y.Z_amd64.deb
   ```
   or let `updpkgsums` fill it in.
3. Check it builds and installs: `makepkg -si`.
4. Commit `chore(release): PKGBUILD X.Y.Z` in a pull request.

## If something goes wrong
- **A workflow failed:** fix it on a branch and merge. Then delete the tag (`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`) and tag again. Only do this while nobody has installed the release.
- **A bad release is out:** do not reuse its version. Release `X.Y.Z+1` with the fix and say so in the changelog.
