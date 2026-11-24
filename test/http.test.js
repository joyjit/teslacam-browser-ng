// Checks a running server from the outside, the way a visitor (or an
// attacker) would reach it. Works the same against `node server.js` and the
// Docker image.
//
//   BASE=http://localhost:8088 [MODE=teslausb] [CLIPS=<clip folder>] \
//     node test/http.test.js
//
// The server must be showing the fake clips from scripts/make-fake-clips.sh.
// With CLIPS (the same folder as the server sees, on this machine), a link
// pointing out of the folder is added for a moment, to check links are
// refused.
const assert = require( "assert" )
const fs = require( "fs" )
const path = require( "path" )

const base = ( process.env.BASE || "http://localhost:8088" ).replace( /\/$/, "" )
const teslausb = process.env.MODE === "teslausb"
const clips = process.env.CLIPS

function get( p, options ) { return fetch( base + p, options ) }

function post( p, body )
{
	return get( p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify( body ) } )
}

async function refused( what, response )
{
	var status = ( await response ).status

	assert.ok( status === 403 || status === 404 || status === 400, `${what}: expected a refusal, got ${status}` )
}

async function run()
{
	var page = await get( "/" )
	assert.strictEqual( page.status, 200 )
	assert.ok( ( await page.text() ).includes( "TeslaCam Browser NG" ), "page title" )

	var args = await ( await get( "/args" ) ).json()
	assert.strictEqual( args.version, require( "../package.json" ).version )
	assert.strictEqual( args.mode, teslausb ? "teslausb" : "" )
	assert.strictEqual( args.locked, teslausb )

	var opened = await ( await get( "/openDefaultFolder" ) ).json()
	var events = opened.folderInfos.map( f => f.relative )
	assert.strictEqual( events.length, 6, "six fake events: " + events.join( ", " ) )

	// A clip plays, and can be asked for in pieces (seeking needs this).
	var files = await ( await get( "/files/" + encodeURIComponent( "SentryClips/2026-11-03_14-12-20" ) ) ).json()
	var clip = JSON.stringify( files ).match( /videos\/[^"]+-front\.mp4/ )
	assert.ok( clip, "front camera clip listed" )
	var part = await get( "/" + clip[ 0 ], { headers: { Range: "bytes=0-99" } } )
	assert.strictEqual( part.status, 206 )
	assert.strictEqual( ( await part.arrayBuffer() ).byteLength, 100 )

	// Nothing outside the clip folder: not by "..", not through a link.
	await refused( "files ..", get( "/files/" + encodeURIComponent( "../../../etc" ) ) )
	await refused( "files .. inside", get( "/files/" + encodeURIComponent( "SentryClips/../../.." ) ) )
	await refused( "video ..", get( "/videos/..%2F..%2F..%2Fetc%2Fpasswd" ) )
	assert.ok( !( await ( await get( "/videos/../../../etc/passwd" ) ).text() ).includes( "root:" ), "video .. plain" )
	await refused( "delete files ..", post( "/deleteFiles", [ "../outside.mp4" ] ) )
	await refused( "delete open folder", post( "/deleteFolder", { folder: "" } ) )
	await refused( "delete folder ..", post( "/deleteFolder", { folder: "../.." } ) )
	await refused( "note ..", get( "/notes/" + encodeURIComponent( "../../x" ), {
		method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify( { text: "x" } ) } ) )

	if ( clips )
	{
		fs.symlinkSync( "/", path.join( clips, "SavedClips", "escape" ) )
		await refused( "files through link", get( "/files/" + encodeURIComponent( "SavedClips/escape/etc" ) ) )
		await refused( "video through link", get( "/videos/SavedClips/escape/etc/passwd" ) )
		await refused( "delete through link", post( "/deleteFolder", { folder: "SavedClips/escape/tmp" } ) )
	}

	if ( teslausb )
	{
		// Locked to one folder; deleting only moves whole events to the trash.
		await refused( "open another folder", get( "/openFolder" + encodeURIComponent( "/etc" ) ) )
		await refused( "delete single files", post( "/deleteFiles", [ "SentryClips/2026-11-03_14-12-20/x.mp4" ] ) )
		assert.strictEqual( ( await get( "/notes" ) ).status, 200 )
		assert.strictEqual( ( await get( "/trash" ) ).status, 200 )
	}
	else
	{
		// No notes or trash outside TeslaUSB mode.
		assert.strictEqual( ( await get( "/trash" ) ).status, 404 )
	}
}

function cleanUp()
{
	if ( clips ) try { fs.unlinkSync( path.join( clips, "SavedClips", "escape" ) ) } catch ( e ) {}
}

cleanUp()
run().then(
	() => { cleanUp(); console.log( `http tests passed (${base}, ${teslausb ? "teslausb" : "default"} mode)` ) },
	e => { cleanUp(); console.error( e ); process.exit( 1 ) } )
