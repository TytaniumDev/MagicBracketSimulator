fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Mac

### mac seed_certs

```sh
[bundle exec] fastlane mac seed_certs
```

Seed the match certs repo with a Developer ID Application cert + profile (run once locally)

### mac sync_certs

```sh
[bundle exec] fastlane mac sync_certs
```

Install signing assets from match (read-only)

### mac release

```sh
[bundle exec] fastlane mac release
```

Build, sign, and notarize the macOS Flutter app for outside-MAS distribution

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
