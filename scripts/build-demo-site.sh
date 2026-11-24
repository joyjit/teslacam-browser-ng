#!/usr/bin/env bash
# Build a static copy of the web page that plays a fixed set of clips, for
# GitHub Pages or any plain file host.
#
#   scripts/build-demo-site.sh <clips>/TeslaCam <out-dir>
#
# Runs the server on the clips, saves its answers as plain
# files at the same paths the page asks for, and copies the page, its
# libraries and the clips next to them. The clips should already be made safe
# to share (see scripts/make-demo-clips.py). Needs node, curl and the
# installed node_modules. Uses port 8088.
set -euo pipefail

clips=$(cd "$1" && pwd)
out=$2
here=$(cd "$(dirname "$0")/.." && pwd)
port=8088

rm -rf "$out"
mkdir -p "$out/files" "$out/videos"

node "$here/server.js" "$clips" >/dev/null &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for _ in $(seq 50); do
	curl -sf "localhost:$port/args" >/dev/null && break
	sleep 0.2
done

get() { curl -sf "localhost:$port/$1"; }

# Hide this machine's folders: every path starts at the clip folder's name
# ("TeslaCam/..."). A static copy cannot browse folders, so it is locked.
parent=$(dirname "$clips")
tidy() {
	node -e '
		const parent = process.argv[1] + "/"
		const text = require( "fs" ).readFileSync( 0, "utf8" )
		const a = JSON.parse( JSON.stringify( JSON.parse( text ),
			( k, v ) => typeof v === "string" ? v.split( parent ).join( "" ) : v ) )
		a.locked = true
		if ( a.folderPathParts ) a.folderPathParts = [ { path: a.folder, name: a.parsedFolder.base } ]
		if ( a.parsedFolder ) a.parsedFolder.root = a.parsedFolder.dir = ""
		process.stdout.write( JSON.stringify( a ) )' "$parent"
}

get openDefaultFolder | tidy > "$out/openDefaultFolder"
get reopenFolders | tidy > "$out/reopenFolders"
get args | tidy > "$out/args"

node -e '
	const a = JSON.parse( require( "fs" ).readFileSync( process.argv[1], "utf8" ) )
	for ( const f of a.folderInfos ) console.log( f.relative )' \
	"$out/openDefaultFolder" | while read -r rel; do
	mkdir -p "$out/files/$(dirname "$rel")" "$out/videos/$rel"
	get "files/$rel" > "$out/files/$rel"
	cp "$clips/$rel"/*.mp4 "$clips/$rel"/event.json "$out/videos/$rel/"
	[ -f "$clips/$rel/thumb.png" ] && cp "$clips/$rel/thumb.png" "$out/videos/$rel/"
done

# The page, its scripts and styles, and the library files it links to.
cd "$here"
cp app.css web.css helpers.js hevc.js ui.js web.js demo.js "$out/"
grep -oE '(src|href)="node_modules/[^"]+"' web.html | cut -d'"' -f2 |
	while read -r f; do
		mkdir -p "$out/$(dirname "$f")"
		cp "$f" "$out/$f"
	done
# Icon font files the open-iconic stylesheet points to.
cp -r node_modules/open-iconic/font/fonts "$out/node_modules/open-iconic/font/"

# demo.js (sample archive / your own folder, switched in the top bar) goes
# in before web.js and replaces the server calls.
tag='<script type="text/javascript" src="web.js"></script>'
grep -qF "$tag" web.html
sed "s|$tag|<script type=\"text/javascript\" src=\"demo.js\"></script>\n  $tag|" \
	web.html > "$out/index.html"
touch "$out/.nojekyll"

if grep -rlF "$parent" "$out"; then
	echo "Stopped: the files above still contain $parent" >&2
	exit 1
fi

echo "Built $out ($(du -sh "$out" | cut -f1))"
