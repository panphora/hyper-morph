# Changelog

## [Unreleased]

### Changed
- License: relicensed to MIT-0 (MIT No Attribution). Same rights, attribution no longer required for our code; Idiomorph-derived portions are covered in the new THIRD-PARTY-NOTICES.md.

## [0.5.0] - 2026-08-16

### Added
- `findChangedRoots` and `spliceProtected` for scoped DOM sync
- Three-way JSON merge for mergeable script tags (0.4.0)
- `kind`, `status`, and `url` declared in the hyper key

### Changed
- `findChangedRoots` now promotes keyless dirty roots to the nearest keyed ancestor
- Pinned Playwright to 1.56.1

### Fixed
- Protected-splice blockers found in the final review


