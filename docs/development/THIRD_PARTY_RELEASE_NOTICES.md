# Third-party notices for desktop release builds

The Tauri desktop build generates `dist/THIRD_PARTY_NOTICES.txt` after the
frontend build and includes it in the embedded frontend assets. In Settings →
Credits, choose **Third-party licenses**. This view uses the local application
origin and does not need an Internet connection. The project’s own code and
content licensing remain unchanged.

The generator uses installed production npm packages and Cargo's locked normal
dependency graph for the desktop target. It includes the original notices
shipped by each package, exact package versions and source locations; the
vendored Tauri runtime includes its local change record. This is a conservative
inventory, not proof that each entry is present in the binary and not a complete
list of additional OS components shipped by the packager.

## Reviewed application dependency supplements

`docs/third-party/notices/manifest.json` pins supplemental notices to the exact
crate name, version, declared license and `.cargo_vcs_info.json` commit. Every
supplement file has a SHA-256 and its upstream URL. These are local inputs to
the build; the generator does not fetch license texts from the Internet.
`.gitattributes` preserves the reviewed bytes on Windows as well as Linux.

The supplements cover `alloc-stdlib`, `crc-catalog`, `dlopen2`, `dlopen2_derive`,
`linux-keyutils`, `selectors`, five `unic-*` packages, and the three
`webview2-com*` packages, at the versions listed in the manifest. Original
copyright notices and the UNIC author list are included. Some files are shared
between multiple exact-version entries; a package upgrade cannot reuse a
supplement implicitly.

Two upstream commits do not contain standalone license texts:

- `linux-keyutils` 0.2.5 explicitly offers Apache-2.0 or MIT in its README.
  The supplement retains that grant verbatim and selects Apache-2.0, whose
  complete text is supplied by the Apache Software Foundation. It does not
  invent a copyright holder for a replacement MIT template.
- `selectors` 0.36.1 explicitly grants MPL-2.0 in the header of `lib.rs`.
  The supplement retains the header verbatim and includes the complete
  MPL-2.0 text published by Mozilla.

Both cases are identified in the generated notices, rather than presented as
license files shipped in the crate. All other supplemental license texts come
from the crate's recorded upstream commit. Applicable copyright/author files
are retained alongside them.

The build now fails if an application dependency has no nonempty license text,
or a supplement's source binding or checksum differs. `NOTICE` alone does not
pass this check. This checks text presence and source provenance; it is not an
automated determination that all redistribution obligations have been met.

## Reproducing and checking the inventory

After `npm ci` and with Cargo/Rust available, run:

```sh
node scripts/build-third-party-notices.mjs
```

The desktop target is `TAURI_ENV_TARGET_TRIPLE` when provided by Tauri, otherwise
the Rust host target. To inspect the Windows dependency inventory from a Linux
host (this does not build Windows binaries):

```sh
TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-msvc node scripts/build-third-party-notices.mjs
```

In addition to `dist/THIRD_PARTY_NOTICES.txt`, the generator writes
`dist/THIRD_PARTY_NOTICES.inventory.json` with target, project version, lockfile
hashes, per-text hashes/provenance and the SHA-256 of the text file. Neither file
contains local package paths. MPL entries identify the corresponding source
archive for that exact crate version. The notices and source URLs are available
in the existing local Settings viewer; following an external source URL still
requires Internet access.

Re-run the generator after every frontend rebuild: Vite replaces `dist`.
With all dependencies already cached, `CARGO_NET_OFFLINE=true` can verify that
the inventory and its supplements can be generated without network access.
Tests: `npm test -- scripts/third-party-notices.test.mjs`.

For a dependency update, review the registry archive's recorded VCS commit and
the applicable upstream texts; add new version-specific entries and their
hashes. Preserve original bytes, authorship, copyright and NOTICE files. Do not
carry a supplement forward by changing only its version number.

## Release acceptance still required

Before publishing the next release:

1. Run the Tauri build on Windows and Linux. A dependency without a license text
   now fails the generator. Review new or changed upstream notices and exact
   source availability information for any MPL-covered code shipped in binaries.
2. Inspect AppImage contents separately for bundled system libraries and include
   the notices and corresponding source information required by their licences.
   Also check which native components are actually included in the other
   packages. Document any manual additions so they can be regenerated.
3. Test offline access to the notices in installed EXE, MSI, DEB and AppImage
   builds; make the final complete notices available alongside the installers.
   Keep the notices versioned by the exact builds. Windows and Linux inventories
   need not be identical.

Keep an acceptance record per installer: build commit, target, installer
SHA-256, notices SHA-256, inventory SHA-256, inspected native/system component
list, corresponding license/source notices and the offline viewer result. Copy
the final reviewed notices and inventory alongside that installer's assets,
using target-specific names. Do not use a Windows inventory for a Linux package
or regenerate the inventory from a newer dependency tree after building the
installer. If system components require additional texts, preserve them as
reviewed, reproducible build inputs and recheck the final embedded file.

Passing the generator or its tests does not complete AppImage/system-library
inspection or installed EXE/MSI/DEB/AppImage acceptance. Those results must be
recorded separately; do not publish the dependency-only inventory as a claim
of complete installer coverage.

This change does not alter release triggers, tags, versions, or existing assets.
