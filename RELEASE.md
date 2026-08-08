# Releasing Notebooks

Notebooks is distributed as a `.webhapp` referenced by the
[weave-tool-curation](https://github.com/lightningrodlabs/weave-tool-curation)
list. A release is **UI-only**: it bundles the current UI with the *exact same*
frozen happ as every previous release, so all installs stay on the same DNA /
network and existing users' data is preserved.

## Why the happ is frozen (never rebuilt)

The zome wasm embeds the original builder's absolute paths (`~/.cargo/...` and
source paths via the HDK macros). That makes the happ **non-reproducible** on a
different machine/user or in CI — a rebuild produces a different DNA hash, i.e. a
different network. The live DNA was built once (by user "leo"). We reuse those
exact bytes forever.

Frozen DNA: `happSha256 = 8a7584239b7cd4349b08f8083c9dd479b9dc112112cda5c58757f0aff1dda750`

> ⚠️ Do **not** release by uploading the output of `npm run package`. That
> rebuilds the happ locally (your paths → wrong DNA → a forked network). Releases
> must go through the tag-triggered workflow below.

## One-time per DNA version: publish the canonical happ

The frozen happ lives as the `happ-v<dnaVersion>` GitHub release (tag in
`.happ-version`). Recover it from an already-published webhapp and publish it:

```bash
nix develop --command bash scripts/release-happ.sh
```

This downloads a published `.webhapp`, extracts its `notebooks.happ`, verifies
the sha256 equals the frozen DNA above, and creates/updates the `happ-v0.6.0`
release. It only needs to be redone if the DNA version changes (see below).

## Each release: cut a webhapp

1. Bump `version` in `ui/package.json` (must be higher than the installed
   version for Moss to offer it as an upgrade).
2. Commit, then:

   ```bash
   npm run release:webhapp        # tags v<version> and pushes
   ```

3. The [`release-webhapp`](.github/workflows/release-webhapp.yaml) workflow then:
   - downloads the frozen happ from `happ-v0.6.0` and checks its sha256,
   - builds the UI and packs `notebooks.webhapp` (no `--recursive`, so the happ
     is embedded verbatim — never rebuilt),
   - re-verifies the embedded happ still equals the frozen DNA,
   - prints the three curation hashes to the run summary,
   - publishes a **prerelease** GitHub release with `notebooks.webhapp` attached.
      It is deliberately not a draft: draft assets are not served at the public
      `releases/download/<tag>/...` URL Moss fetches, so they 404.
4. Nothing is live yet — updating the curation list below is the go-live gate.

## Update the curation list

The workflow run summary (and the release body) contains:

```json
"hashes": {
  "happSha256": "8a7584239b...",      // always the frozen DNA
  "webhappSha256": "<new>",
  "uiSha256": "<new>"
}
```

Add a new `versions[]` entry for `notebooks` in the curation list with the new
`version`, the release's `notebooks.webhapp` `url`, and these `hashes`. Because
`happSha256` is unchanged, Moss treats it as an in-place upgrade on the same
network. To get the hashes for an artifact locally: `npm run weave-hash`.

## Changing the DNA (rare)

Only when zomes/integrity actually change. Bump `dnaVersion`, make the build
reproducible first (add `--remap-path-prefix` / Cargo `trim-paths` so the wasm
is path-independent), build the new canonical happ, update `.happ-version` and
`scripts/release-happ.sh`'s expected sha, and publish a new `happ-v<dnaVersion>`
release. This intentionally starts a new network.
