#!/usr/bin/env bash
# Draws the panel without MT5 (see preview.cpp): one HTML page per state in tests/native/out/preview.
# Needs node and g++ (C++17), like run.sh.
set -euo pipefail
cd "$(dirname "$0")"
node mql2cpp.js
g++ -std=c++17 -O2 -w -I out/src/Include -I . preview.cpp -o out/panel-preview
mkdir -p out/preview
./out/panel-preview
