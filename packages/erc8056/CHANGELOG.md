# Changelog

Published versions of `@assayhq/erc8056`, each mapped to the commit it was built from.
The repository's git relay cannot push tag refs, so this file is the release record.

Verify any row yourself:

```bash
npm view @assayhq/erc8056@<version> dist.integrity
curl -sSL "$(npm view @assayhq/erc8056@<version> dist.tarball)" | tar xz
# then diff package/dist against a build of the commit below
```

## 0.1.3 — 2026-09-03

Commit [`63ac798`](../../commit/63ac798) · published: pending · integrity: pending
(fill both from the registry after `npm publish`, with the command at the top of this file)

**Runtime-identical to 0.1.2.** `dist/`, `solidity/` and `LICENSE` are byte-for-byte the same,
and the package has zero runtime dependencies, so nothing a consumer installs changes. What did:

- **Test tooling moved onto patched versions.** `vitest` and `@vitest/coverage-v8`
  2.1.8 → 3.2.7, as part of the repository-wide response to CVE-2026-39356
  (`docs/DECISIONS.md` D-2.12), which also cleared two criticals in the 2.x `vitest` line.
  These are `devDependencies` — never installed by a consumer, and invisible to a consumer's
  `npm audit` — but scanners that read a published `package.json` flag them anyway, and this
  package has already drawn one such report.
- **`CHANGELOG.md` now ships in the tarball.** It was added to `files` after 0.1.2 was
  published, so the 0.1.2 tarball does not contain it; this is the first version that does.

Verified before release: 52 tests pass and coverage is 100% on all four axes under vitest 3.2.7.

## 0.1.2 — 2026-09-02

Commit [`3174afb`](../../commit/3174afb) · published 12:55:57 UTC ·
`sha512-ETUNRrbYx/YM4JP+5u9lyiS/4mijM+Smy5rr3DhV+xp1euLZuO26c7ki2iggP+cilcjyictwzDhMtk1PHsF3ZQ==`

- **Fixed a false claim in the README.** The fixture section implied a partial scan; it is the
  complete set — **17 `UIMultiplierUpdated` logs across 10 tokens**, blocks 0 → 52,428,883.
- **Fixed `repository`**, which pointed at the wrong GitHub repository and so was the link npm
  showed on the package page.
- **Added `dedupeMultiplierEvents()`.** Robinhood Chain re-emits some multiplier updates — 2 of
  the 17 logs are exact repeats (CRWD's 4:1 split at blocks 978,630 and 1,231,096, and one
  unlisted token). Fed raw logs, `MultiplierHistory.fromEvents()` throws `chain broken`.
  The helper drops a log only when `oldMultiplier`, `newMultiplier` *and* `effectiveAt` all
  match one already seen, so two genuinely different actions are never merged.
  **`fromEvents()` is unchanged and still throws** — only its error message gained a pointer to
  the helper. Accepting a mismatched chain is how a position gets mis-valued by a whole
  multiple, so the check stays strict (`docs/DECISIONS.md` D-2.6).

Verified against the registry on 2026-09-02: `latest`, MIT, zero runtime dependencies. Every
shipped file is byte-identical to a fresh build of `3174afb`, modulo CRLF line endings added by
the publishing machine.

## 0.1.1 — 2026-09-02

Commit [`f0a563d`](../../commit/f0a563d) · published 11:47:16 UTC

- **Fixed broken entry points in 0.1.0.** `main`, `types` and `exports` had been set under
  `publishConfig`, which pnpm applies at publish time but **npm ignores entirely** — so 0.1.0
  resolved to nothing for npm and yarn users. Moved to the top level of the manifest.

## 0.1.0 — 2026-09-02 · **deprecated**

Commit [`bd08f0a`](../../commit/bd08f0a) · published 11:42:02 UTC

> Broken entry points (main/exports pointed at unpublished src). Use 0.1.1+.

First publish, and unusable for npm consumers: `main`, `types` and `exports` resolved to
`./src/index.ts`, which `files` does not ship. Superseded within five minutes by 0.1.1, and
later marked deprecated on the registry with the message above — `npm install` warns rather
than failing silently. Kept on the registry rather than unpublished, so the integrity hashes
stay resolvable.

The deprecation message predates 0.1.2 and points at "0.1.1+", which is correct about
resolution: 0.1.1's entry points are byte-identical to 0.1.2's. It is not an endorsement of
0.1.1's contents — see that entry.

---

The unscoped name `erc8056` was taken on 2026-07-20 by an unrelated project
(`three-ws`), which is why this package is scoped (`docs/DECISIONS.md` D-2.3).
