---
title: Supported LCIA Source Applicability Companion
docType: contract
scope: repo
status: active
authoritative: true
owner: next
language: en
whenToUse:
  - when reviewing source-bound default factor selection in the browser
  - when preparing a paired Worker and frontend applicability candidate
whenToUpdate:
  - when the supported source companion, scientific basis, or selection policy changes
checkPaths:
  - src/services/lciaMethods/supportedSourcePolicy.ts
  - src/services/lciaMethods/supportedSourcePolicyConstants.ts
  - src/services/lciaMethods/calculation.ts
  - public/lcia-source-policy-v2/**
  - tests/unit/services/lciaMethods/supportedSourcePolicy.test.ts
lastReviewedAt: 2026-10-25
lastReviewedCommit: afc871b576616cfb4cd83455ba6a48d1fbede548
lastReviewedNote: 'Worker #340: reviewed paired immutable companions, source basis, exact Flow classification, conditional generic selection and partial persistence against afc871b57. The 227 unresolved regional default families and separate native/Root acceptance remain explicit.'
---

# Supported source policy

The browser and Worker consume the same additive applicability companion for the unchanged static bundle `1.2.4`. The companion restores the original factor locations, qualifier values, source factor order and source-record hashes; it does not change original XML, Flow or CF values, or the old list/index/manifest bytes. The exact selector policy is `lcia.applicability.source-bound.v3`.

`public/lcia-source-policy-v2/manifest.json` has raw SHA-256 `2ddb0fe715a2b6647246dd443f4fe417868683ca67bbea29c1a81ee7b955142d`. It binds 25 method companions, the reviewed static manifest `e9b4e7f9a5125bb921efbffba9a4b50711f9ea982e22b500f35211884a0479c5`, and the factor manifest `40ffd33323c9882dbd0b0d9c99982bad1752e311062231bcf1f490ee96f92e96`. Browser reads use these fixed same-origin paths with digest query keys; job input, local storage and source UUIDs cannot replace the policy. A missing companion or integrity mismatch yields no trusted numeric output.

The public source is `tiangong-lca/data` at `367642d7994e0e75188e7e241fb2a4b85ffff62f`. Every method entry binds its scientific UUID/version, artifact locator, XML path/raw hash, full native method-adapter hash, metadata hash and ordered numeric digest. The scientific identity alias `503699e0-eca9-4089-8bf8-e0f49c93e578` → locator `9ec743ea-6b00-400d-a53b-61547a3fc03c` stays unchanged.

## Scientific basis and limits

Generic factor ordinals are explicit immutable policy data. The runtime never derives a generic designation from an absent/blank location, a unique numeric value, a method name, or `GLO`. The original location state and source scope remain evidence.

Generic record existence does not establish applicability to the current observation. Source-companion schema `lcia.supported-source-policy.v2` requires `generic_geographic_admission` in every method manifest and companion, bound to the exact source geography hash. The loader checks the literal source `interventionLocation`, not a method name or geography-text heuristic. Twenty reviewed sources declare global admission for their existing designated generic records; five European sources declare only the literal source token `RER`.

For the five Europe-limited sources (freshwater eutrophication, photochemical ozone formation, acidification, terrestrial eutrophication and marine eutrophication), missing, blank, unknown, `BR`, `CN`, arbitrary tokens and unreviewed aliases cannot use a generic record as an ordinary available result. Literal `RER` can select a reviewed generic; an exact source country CF remains first (`DE` NH3 is `4.0`). There is no country-containment inference, Process-geography inheritance or proxy adoption mechanism. A location-independent proof cannot expand a known source's geographic domain.

The [ILCD geography contract](https://eplca.pages.code.europa.eu/ilcd_docs/impactmethod/GeographyType.html) defines intervention location as the region where the method is valid/modelled, and retains additional representativeness restrictions. Source metadata explicitly places these five models in Europe. The flat source location dictionary names tokens but supplies no containment hierarchy; it cannot authorize an unmatched country or alias. Global source-qualified defaults continue to support genuinely nonregional observations, including missing-location Climate factors `1.0`, `273.0` and `29.8`.

The [ILCD characterization-factor contract](https://eplca.pages.code.europa.eu/ilcd_docs/impactmethod/CharacterisationFactorType.html) makes factor location optional and reserves it for methods which use location information. The source-specific model/geography metadata supports the enumerated nonregional families. Four source sets additionally have a defensible generic basis alongside regional alternatives:

| Exact source | Basis for its designated generic records | Scope retained |
| --- | --- | --- |
| Acidification `b5c611c6…@01.04.000` | [JRC supporting CF report](https://eplca.jrc.ec.europa.eu/permalink/TR_SupportingCF_FINAL.pdf), §4.7 / Table 9, PDF page 23, distinguishes generic factors from country factors; original NH3 records contain generic `3.02` and DE `4.0` | European model |
| Terrestrial eutrophication `b5c614d2…@01.02.009` | Same report, §4.8, PDF page 24, identifies site-independent nitrogen-compound CFs alongside country factors | European model |
| Marine eutrophication `b5c619fa…@02.00.010` | Exact native `dataSetInformation/common:generalComment` and `useAdviceForDataSet` describe averaged CFs from country-dependent assessments | Europe |
| Photochemical ozone formation `b5c610fe…@02.01.000` | Exact native `impactModel/modelDescription` describes LOTOS-EUROS averaging over 14,000 grid cells to define European factors; use advice retains that scope | Europe |

The report is supporting interpretation, not a license to replace source values or import another method version. Current raw XML and numeric tuple identities remain authoritative. No new unit, compartment, inventory-validity or full scientific certification is implied.

There are 227 regional families without a sufficiently established generic-default basis in this candidate: five in each of four toxicity source sets, 171 land-use families, 11 water-use families and 25 PM families. They retain exact regional selection. If an active observation has no applicable exact regional record or geographically admitted designated generic, that category is unavailable. This limitation is visible in each companion manifest entry, rather than hidden as zero or a whole-calculation exception.

The original PM source contains 306 nonempty factor comments. They are retained, and their exact source-bound review records classify them as labels already present in the referenced Flow's compartment/stack description. This classification does not authorize arbitrary comments or new conditions; changed source bytes cannot inherit it.

## Selection and result contract

The selector requires the exact Flow version and direction. It first selects a unique literal region match, then a unique explicitly designated generic record only when the separate source-bound geographic admission permits this observation. Multiple applicable records are ambiguous even if their values are equal. Explicit zero remains a selected source value. Regional alternatives are never accumulated.

The production browser adapter first classifies every inventory exchange with the authoritative `typeOfDataSet` from its exact Flow UUID/version. It reuses existing metadata, deduplicates revisions, and calls the existing `getFlowProperties` reader in batches of at most 100 with at most four concurrent batches. That reader's historical fallback to another revision never verifies classification: returned UUID/version must equal the requested pair. Only confirmed Product/Waste flows are excluded from characterization; reference flags and factor presence/absence cannot classify a flow. Unknown, unreadable or conflicting classification yields an explicit LCIA failure while the generated Process retains its LCI exchanges. The parent model resolves shared metadata once for all generated groups.

The report retains `lcia.inventory-classification.v1` with the exact exchange/revision/type bindings, counts and metadata digest. A confirmed inventory with no elementary exchanges has known zero impact: all categories remain available at zero. Its empty coverage matrix is admitted only with that current-policy classification receipt and complete availability. An unclassified empty observation set returns no numerical result; legacy/service empty matrices keep their strict rejection. Both honest current failure and classified-empty zero reports round-trip through the static evidence parser.

The existing shared Flow/version axis remains supported only when all active contexts select the identical source record. A category needing different regional records on one shared axis is unavailable. Missing factors and unresolved applicability retain their reasons; numeric subtotals for an unavailable category are not returned as complete category results.

`calculateStaticLcia` returns the complete category view axis: available rows have finite `meanAmount` and unavailable rows have `meanAmount:null`, `status:unavailable` and reasons. Its report binds the policy manifest and carries `lcia.category-availability.v1`. Independent categories and the inventory survive an unresolved category. The owning [calculation evidence contract](lcia-calculation-evidence.md) defines consumer display, historical reads and complete-result claims.

Nullable view rows are not scientific TIDAS `LCIAResult` records. `persistableStaticLciaResults` checks the frozen exact method/version availability, removes unavailable and non-finite rows, and strips view-only status/reasons. `lifeCycleModels/util_calculate.ts` uses this adapter before assembling generated Process records. The full availability report persists in `LCIAResults/common:other`, allowing the UI to reconstruct unavailable categories without writing null or stale numeric results into the scientific result array.

## Reproduce the additive companion

Worker owns `scripts/build_lcia_source_policy.py`. Run it with explicit source/cache paths and a new output directory:

```sh
python3 scripts/build_lcia_source_policy.py \
  --source-root /absolute/read-only/data-checkout \
  --cache-root /absolute/read-only/platform/public/lciamethods \
  --output-directory /absolute/new-companion-directory
```

The authoring tool verifies every XML file against its fixed Git blob, verifies the old release hashes, and consumes every exact method/Flow/version/direction/Decimal-value tuple one-to-one. It records original raw factor XML SHA-256s and ordered numeric bindings without copying numeric CF values into the companion. It refuses an existing output directory or a destination inside either protected input tree. The reviewed recipe deliberately leaves the 227 regional defaults unresolved.

Generation produced 319,575 record bindings and 18,972,702 compressed bytes. The version-3 geography revision preserves all 319,575 source/cache mappings, factor locations, qualifiers, generic ordinals and original XML/metadata/numeric digests; only the admission/basis/schema/pins change. New candidate identity and acceptance are required. Copy these 26 bytes-identical files into the paired reader distributions; do not rerun the old reference-cache generator. Any policy or source change requires new hashes and coordinated scientific/native qualification before runtime adoption.

## Focused validation

`tests/unit/services/lciaMethods/supportedSourcePolicy.test.ts` consumes the original reviewed numeric cache and these exact companions. Its source vectors match Worker tests: missing-location fossil CO2 `1.0`, literal-source-context `RER` NH3 generic `3.02`, exact DE `4.0`, restricted-source missing/blank/unknown/BR/CN refusal, exact-version refusal and a selected explicit zero. It also covers manifest/companion/numeric tamper, per-category partial output and identical-source reuse across contexts. The generated-Process integration fixture verifies available zero survives while nullable and stale unavailable rows do not enter TIDAS numerical results.

Local tests establish reader/selector contracts. They do not merge, deploy, change a default runtime, regenerate protected assets, or substitute for Root's acceptance of an immutable runtime candidate and affected original workflows.
