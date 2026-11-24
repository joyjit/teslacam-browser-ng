// The static demo site: the sample archive, and "My USB stick", which reads
// a folder from the visitor's own computer in the browser.
const fs = require( "fs" )
const path = require( "path" )
const h = require( "./helpers" )
const { test, expect } = h

// Every clip file, relative to the TeslaCam folder.
function clipFiles( dir, prefix = "" )
{
	return fs.readdirSync( dir, { withFileTypes: true } ).flatMap( d => d.isDirectory()
		? clipFiles( path.join( dir, d.name ), prefix + d.name + "/" )
		: [ prefix + d.name ] )
}

test.describe( "sample archive", () =>
{
	test.beforeEach( async ( { page } ) =>
	{
		await page.goto( "./" )
		await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
	} )

	test( "shows the demo switch and plays an event", async ( { page } ) =>
	{
		await expect( page.locator( ".demo-switch button" ) ).toHaveText( [ /Sample archive/, /My USB stick/ ] )
		await expect( page.locator( ".demo-switch button.on" ) ).toHaveText( /Sample archive/ )
		await h.openEvent( page, h.SIX_CAMERAS )
		await h.playInStep( page, 6 )
	} )

	test( "Keep star and trash stay in this browser", async ( { page } ) =>
	{
		await h.openEvent( page, h.FOUR_CAMERAS )
		await page.locator( ".keep-button" ).click()
		await page.reload()
		await expect( page.locator( ".keep-button" ) ).toHaveText( /Kept/ )

		page.once( "dialog", d => d.accept() )
		await page.getByRole( "button", { name: "Delete event" } ).click()
		await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS - 1 )
		await page.locator( ".trash-button" ).click()
		await page.locator( ".trash-item" ).getByRole( "button", { name: "Restore" } ).click()
		await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
	} )
} )

test.describe( "My USB stick", () =>
{
	test.skip( !process.env.CLIPS, "needs CLIPS, the fake clip folder" )

	test.beforeEach( async ( { page } ) =>
	{
		await page.goto( "./" )
		await page.locator( ".demo-switch button", { hasText: "My USB stick" } ).click()
		await expect( page ).toHaveURL( /mode=usb/ )
		await expect( page.locator( ".demo-note" ) ).toContainText( "Nothing is uploaded" )
	} )

	test( "Chrome's folder picker", async ( { page } ) =>
	{
		// The real picker is a system dialog a test can't click. Put the clips
		// in the browser's private storage and have the picker hand that folder
		// over, the same kind of folder the real picker returns.
		var files = clipFiles( process.env.CLIPS )

		await page.evaluate( async files =>
		{
			var root = await navigator.storage.getDirectory()

			for ( var file of files )
			{
				var parts = ( "TeslaCam/" + file ).split( "/" )
				var dir = root

				for ( var name of parts.slice( 0, -1 ) ) dir = await dir.getDirectoryHandle( name, { create: true } )

				var data = await ( await fetch( "videos/" + file ) ).blob()
				var out = await ( await dir.getFileHandle( parts.at( -1 ), { create: true } ) ).createWritable()

				await out.write( data )
				await out.close()
			}

			window.showDirectoryPicker = async () => ( await navigator.storage.getDirectory() ).getDirectoryHandle( "TeslaCam" )
		}, files )

		await page.getByRole( "button", { name: "Choose a folder…" } ).click()
		await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
		await expect( page.locator( ".folder-button" ) ).toContainText( "TeslaCam" )
		await h.openEvent( page, h.SIX_CAMERAS )
		await h.playInStep( page, 6 )
	} )

	test( "older folder picker (Firefox, Safari)", async ( { page } ) =>
	{
		await page.evaluate( () => { window.showDirectoryPicker = undefined } )

		var chooser = page.waitForEvent( "filechooser" )

		await page.getByRole( "button", { name: "Choose a folder…" } ).click()
		await ( await chooser ).setFiles( process.env.CLIPS )
		await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
		await h.openEvent( page, h.FOUR_CAMERAS )
		await h.playInStep( page, 4 )
	} )
} )
