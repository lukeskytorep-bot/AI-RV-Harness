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

Before publishing the next release:

1. Run the Tauri build on Windows and Linux. Review the **Upstream license texts
   to review before public release** section. For packages without a licence
   text in their registry archive, verify the corresponding upstream version
   and include the applicable licence and copyright text. A metadata field or
   source URL alone is not a replacement for required notices. Retain exact
   source availability information for any MPL-covered code shipped in binaries.
2. Inspect AppImage contents separately for bundled system libraries and include
   the notices and corresponding source information required by their licences.
   Also check which native components are actually included in the other
   packages. Document any manual additions so they can be regenerated.
3. Test offline access to the notices in installed EXE, MSI, DEB and AppImage
   builds; make the final complete notices available alongside the installers.
   Keep the notices versioned by the exact builds. Windows and Linux inventories
   need not be identical.

This change does not alter release triggers, tags, versions, or existing assets.
