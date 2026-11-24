#!/usr/bin/env bash
# Run the server checks and the browser tests against servers that are
# already running (from source or from the Docker image). Leave out any
# address to skip that set.
#
#   SERVER_URL      server in the default mode, showing CLIPS
#   TESLAUSB_URL    server in TeslaUSB mode, showing TESLAUSB_CLIPS
#   DEMO_URL        static demo site built from CLIPS
#   CLIPS           fake clips from scripts/make-fake-clips.sh (.../TeslaCam)
#   TESLAUSB_CLIPS  a writable copy of them for TeslaUSB mode
set -euo pipefail
cd "$(dirname "$0")/.."

wait_for() {
	node -e '
		const url = process.argv[1]
		;( async () => {
			for ( let i = 0; i < 60; i++ ) {
				try { if ( ( await fetch( url ) ).ok ) return } catch ( e ) {}
				await new Promise( r => setTimeout( r, 500 ) )
			}
			console.error( "No answer from " + url )
			process.exit( 1 )
		} )()' "$1"
}

if [[ -n "${SERVER_URL:-}" ]]; then
	wait_for "$SERVER_URL"
	BASE="$SERVER_URL" CLIPS="${CLIPS:-}" node test/http.test.js
fi
if [[ -n "${TESLAUSB_URL:-}" ]]; then
	wait_for "$TESLAUSB_URL"
	BASE="$TESLAUSB_URL" MODE=teslausb CLIPS="${TESLAUSB_CLIPS:-}" \
		node test/http.test.js
fi
if [[ -n "${DEMO_URL:-}" ]]; then
	wait_for "$DEMO_URL"
fi

npx playwright test
