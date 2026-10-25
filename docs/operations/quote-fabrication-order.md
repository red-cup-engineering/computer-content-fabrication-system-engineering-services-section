# quoteFabricationOrder

`quoteFabricationOrder({ kind, tier?, inputs? }, { profiles? }) -> FabricationQuote | FabricationQuoteRefusal`

NDJSON: `node scripts/quote-fabrication-order.mjs`.

The price, turnaround, deliverables and acceptance assays of a kind, from its profile; for a kind priced by tier (lean-proof), at the declared tier.

## Input

`{ kind, tier? , inputs? }`; the tier is read from `inputs.tier` when not given.

## Refusals

- `UNKNOWN_KIND`
- `MISSING_TIER`
- `UNKNOWN_TIER`
- `UNEXPECTED_FIELD`, `INVALID_ORDER`

## Precondition

`kind` has a profile; a tier-priced kind has one of its profile's tiers.

## Postcondition

`price.amount` is the profile's dollar price (and `price.cents` its integer cents); `turnaround.seconds` the profile's, or the tier's.

## Preserved frame

Nothing is read or written.

## Effect class

pure; replay safe; coordination-free; deterministic.

## Witness

The profile record it reads (`data/records/kinds/<kind>.json`); `test/order.test.mjs`.
