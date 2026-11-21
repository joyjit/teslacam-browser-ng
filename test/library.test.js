const assert = require( "assert" )
const fs = require( "fs" )
const os = require( "os" )
const path = require( "path" )
const helpers = require( "../helpers" )
const hevc = require( "../hevc" )
const services = require( "../services" )

function writeClip( dir, name )
{
	fs.mkdirSync( dir, { recursive: true } )
	fs.writeFileSync( path.join( dir, name ), "" )
}

const root = fs.mkdtempSync( path.join( os.tmpdir(), "teslacam-" ) )
const sentry = path.join( root, "TeslaCam", "SentryClips", "2024-05-01_12-00-00" )
const track = path.join( root, "TeslaCam", "TrackMode", "2024-05-02_08-15-30" )

writeClip( sentry, "2024-05-01_11-59-00-front.mp4" )
writeClip( sentry, "2024-05-01_11-59-00-left_repeater.mp4" )
writeClip( sentry, "2024-05-01_11-59-00-right_pillar.mp4" )
writeClip( sentry, "2024-05-01_11-59-00-back.mp4" )
writeClip( sentry, "2024-05-01_11-59-00-cabin.mp4" )
fs.writeFileSync( path.join( sentry, "event.json" ), JSON.stringify(
{
	reason: "sentry_aware_object_detection",
	city: "Example",
	est_lat: "37.0",
	est_lon: "-122.0",
	timestamp: "2024-05-01T19:00:00Z"
} ) )
writeClip( track, "2024-05-02_08-14-00-front.mp4" )
writeClip( sentry, "thumb.png" )
fs.writeFileSync( path.join( sentry, "event.json.bak" ), "{" )

services.setFolder( root )
const opened = services.openFolder( root )

assert.strictEqual( opened.folderInfos.length, 2 )
const sentryInfo = opened.folderInfos.find( info => info.category === "Sentry" )
const trackInfo = opened.folderInfos.find( info => info.category === "Track" )

assert.ok( sentryInfo, "SentryClips should be labeled Sentry" )
assert.strictEqual( sentryInfo.event.reason, "sentry_aware_object_detection" )
assert.ok( trackInfo, "TrackMode should be labeled Track" )
assert.strictEqual( trackInfo.event, null )
assert.strictEqual( sentryInfo.thumb, true, "thumb.png should be flagged" )
assert.strictEqual( trackInfo.thumb, false )

const files = services.getFiles( sentryInfo.relative, filePath => filePath )
const cameras = files.clips[ 0 ][ 1 ].map( clip => clip.camera ).sort()

assert.deepStrictEqual( cameras, [ "back", "cabin", "front", "left_repeater", "right_pillar" ] )
assert.strictEqual( files.event.city, "Example" )

const broken = path.join( root, "TeslaCam", "SavedClips", "2024-06-01_00-00-00" )
writeClip( broken, "2024-06-01_00-00-00-front.mp4" )
fs.writeFileSync( path.join( broken, "event.json" ), "{not json" )
const saved = services.openFolder( root ).folderInfos.find( info => info.category === "Saved" )

assert.ok( saved )
assert.strictEqual( saved.event, null )
assert.strictEqual( services.getFiles( saved.relative, filePath => filePath ).event, null )

const removed = services.deleteFolder( saved.relative )

assert.strictEqual( fs.existsSync( broken ), false )
assert.strictEqual( services.deleteFiles( null ), undefined )
assert.strictEqual( services.deleteFiles( {} ), undefined )
assert.ok( removed === undefined )

const reopened = services.reopenFolders()

assert.ok( reopened.folderInfos.some( info => info.category === "Sentry" ) )
assert.ok( !reopened.folderInfos.some( info => info.category === "Saved" ) )

const recentDay = path.join( root, "TeslaCam", "RecentClips", "2024-07-04" )
writeClip( recentDay, "2024-07-04_01-02-03-front.mp4" )
writeClip( path.join( root, "TeslaCam", "RecentClips", "not-a-date" ), "2024-07-04_01-02-03-back.mp4" )

const withRecent = services.openFolder( root )
const recentInfo = withRecent.folderInfos.find( info => info.category === "Recent" && info.relative.indexOf( "2024-07-04" ) >= 0 )

assert.ok( recentInfo, "date-only RecentClips folders should be scanned" )
assert.ok( !withRecent.folderInfos.some( info => info.relative.indexOf( "not-a-date" ) >= 0 ) )

const recentFiles = services.getFiles( recentInfo.relative, filePath => filePath )

assert.strictEqual( recentFiles.clips[ 0 ][ 1 ][ 0 ].camera, "front" )

const positive = hevc.detect(
{
	canPlayType: type => type.indexOf( "hvc1" ) >= 0 ? "probably" : "",
	isTypeSupported: () => false
} )

assert.strictEqual( positive.supported, true )
assert.strictEqual( positive.message, "" )

const negative = hevc.detect(
{
	canPlayType: type => type.indexOf( "avc1" ) >= 0 ? "probably" : "",
	isTypeSupported: () => false
} )

assert.strictEqual( negative.supported, false )
assert.ok( negative.message.indexOf( "HEVC" ) >= 0 )
assert.strictEqual( negative.avc.canPlayType, "probably" )
assert.ok( negative.hevc.every( result => result.canPlayType === "" && result.mediaSource === false ) )

const maybeOnly = hevc.detect(
{
	canPlayType: () => "maybe",
	isTypeSupported: () => false
} )

assert.strictEqual( maybeOnly.supported, false )
assert.strictEqual( maybeOnly.maybe, true )

const folderMatch = helpers.matchFolder( "2024-05-01_12-00-00" )
const clipMatch = helpers.matchClip( "2024-05-01_11-59-00-cabin.mp4" )

assert.strictEqual( folderMatch.groups.s, "00" )
assert.strictEqual( clipMatch.groups.c, "cabin" )

services.setFolder( "" )
const empty = services.openFolder( "" )

assert.strictEqual( empty.folder, "" )
assert.deepStrictEqual( empty.folderInfos, [] )

// TeslaUSB mode: notes are kept in <folder>/.teslacam-browser/notes.json.
assert.throws( () => services.setMode( "nope" ), /Unknown mode/ )
services.setFolder( root )
services.setMode( "" )
assert.strictEqual( services.getNotes().enabled, false )
assert.throws( () => services.saveNote( "SentryClips/x", { text: "hi" } ), /off/ )

services.setMode( "teslausb" )
assert.strictEqual( services.openFolder( root ).locked, true )
assert.strictEqual( services.getNotes().writable, true )

const savedNote = services.saveNote( "/TeslaCam/SentryClips/2024-05-01_12-00-00", { text: "Bike near car", keep: true }, "joyjit" )
assert.strictEqual( savedNote.by, "joyjit" )
assert.strictEqual( savedNote.keep, true )

// Read back from disk.
services.setMode( "teslausb" )
const reloaded = services.getNotes().notes[ "TeslaCam/SentryClips/2024-05-01_12-00-00" ]
assert.strictEqual( reloaded.text, "Bike near car" )

// Empty and not kept: removed.
assert.strictEqual( services.saveNote( "TeslaCam/SentryClips/2024-05-01_12-00-00", { text: " ", keep: false } ), null )
assert.deepStrictEqual( services.getNotes().notes, {} )

// Trash: Delete moves an event folder away; it can be restored or removed.
const doomed = path.join( root, "TeslaCam", "SentryClips", "2024-07-01_10-00-00" )
writeClip( doomed, "2024-07-01_09-59-00-front.mp4" )
services.saveNote( "TeslaCam/SentryClips/2024-07-01_10-00-00", { text: "note survives a restore" } )

assert.throws( () => services.trashEvent( "TeslaCam/SentryClips", "joyjit" ), /Not an event folder/ )
assert.throws( () => services.trashEvent( "", "joyjit" ), /Not an event folder/ )
assert.throws( () => services.trashEvent( "../..", "joyjit" ), /Not an event folder/ )

const trashed = services.trashEvent( "TeslaCam/SentryClips/2024-07-01_10-00-00", "preetha" )
assert.strictEqual( fs.existsSync( doomed ), false )
assert.strictEqual( trashed.by, "preetha" )
assert.strictEqual( services.listTrash().length, 1 )
assert.ok( !services.openFolder( root ).folderInfos.some( i => i.relative.endsWith( "2024-07-01_10-00-00" ) ), "trashed event leaves the list" )
assert.throws( () => services.restoreTrash( "../../etc" ), /Not in the trash/ )

services.restoreTrash( trashed.id )
assert.ok( fs.existsSync( path.join( doomed, "2024-07-01_09-59-00-front.mp4" ) ) )
assert.strictEqual( services.listTrash().length, 0 )
assert.strictEqual( services.getNotes().notes[ "TeslaCam/SentryClips/2024-07-01_10-00-00" ].text, "note survives a restore" )

// Removing for good takes the note with it.
const again = services.trashEvent( "TeslaCam/SentryClips/2024-07-01_10-00-00", "joyjit" )
services.purgeTrash( again.id )
assert.strictEqual( services.listTrash().length, 0 )
assert.strictEqual( services.getNotes().notes[ "TeslaCam/SentryClips/2024-07-01_10-00-00" ], undefined )

// Entries older than the limit are removed automatically.
writeClip( doomed, "2024-07-01_09-59-00-front.mp4" )
const old = services.trashEvent( "TeslaCam/SentryClips/2024-07-01_10-00-00", "joyjit" )
const infoFile = path.join( root, ".teslacam-browser", "trash", old.id, "info.json" )
const info = JSON.parse( fs.readFileSync( infoFile, "utf8" ) )
info.deletedAt = new Date( Date.now() - 31 * 86400000 ).toISOString()
fs.writeFileSync( infoFile, JSON.stringify( info ) )
services.purgeOldTrash()
assert.strictEqual( services.listTrash().length, 0 )

// A file that can't be read is never overwritten.
fs.writeFileSync( path.join( root, ".teslacam-browser", "notes.json" ), "{" )
services.setMode( "teslausb" )
assert.strictEqual( services.getNotes().writable, false )
assert.throws( () => services.saveNote( "TeslaCam/SentryClips/x", { text: "hi" } ), /Can't read/ )
assert.strictEqual( fs.readFileSync( path.join( root, ".teslacam-browser", "notes.json" ), "utf8" ), "{" )
services.setMode( "" )

console.log( "library tests passed" )
