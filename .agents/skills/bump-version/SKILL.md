---
name: bump-version
description: >-
  Bump the project version number across manifest.json and package.json, then
  create a git tag. Use when the user says "bump version", "release",
  "new version", "version bump", or asks to increment the version number.
---

# Bump Version

## Workflow

1. **Read current version** from `package.json`
2. **Determine bump type** — ask the user if not specified:
   - `patch` (1.0.5 → 1.0.6)
   - `minor` (1.0.5 → 1.1.0)
   - `major` (1.0.5 → 2.0.0)
3. **Update both files** with the new version:
   - `package.json` → `"version": "X.Y.Z"`
   - `manifest.json` → `"version": "X.Y.Z"`
4. **Commit** the version change:
   ```
   git add package.json manifest.json
   git commit -m "bump version to X.Y.Z"
   ```
5. **Tag** the commit:
   ```
   git tag vX.Y.Z
   ```
6. Report the new version and remind the user to `git push --tags` when ready.

## Rules

- Always keep `package.json` and `manifest.json` versions in sync.
- Use the `v` prefix for git tags (e.g. `v1.1.0`).
- Do **not** push automatically — let the user decide when to push.
