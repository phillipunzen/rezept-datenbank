#!/bin/sh
set -eu
# Each workflow gets isolated data, including global bootstrap/admin invariants.
for spec in tests/integration/*.test.ts; do
 node scripts/reset-test.cjs
 node_modules/.bin/tsx --test "$spec"
done
