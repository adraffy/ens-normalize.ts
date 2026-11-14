#!/usr/bin/env sh
# downloads the derived spec + tests from ens-normalize.js
cd "$(dirname "$0")"
BASE=https://raw.githubusercontent.com/adraffy/ens-normalize.js/main

# spec
curl -fsSo ./data/spec.json $BASE/derive/output/spec.json
curl -fsSo ./data/nf.json $BASE/derive/output/nf.json

# tests
curl -fsSo ./test/data/tests.json $BASE/validate/tests.json
curl -fsSo ./test/data/nf-tests.json $BASE/derive/output/nf-tests.json
