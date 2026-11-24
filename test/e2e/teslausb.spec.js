// TeslaUSB mode: one locked clip archive, notes and Keep stars saved on the
// server, and deleting moves events to a trash. Each test undoes what it
// changes, so the set can run again on the same folder.
const h = require( "./helpers" )
const { test, expect } = h

// A note as the server has it, or null.
async function savedNote( request, relative )
{
	var notes = await ( await request.get( "notes" ) ).json()

	return JSON.stringify( notes ).includes( relative ) ? notes : null
}

test.beforeEach( async ( { page, request } ) =>
{
	// Clear what an earlier, failed run may have left.
	for ( var relative of [ h.FOUR_CAMERAS, h.SIX_CAMERAS ] )
	{
		await request.put( "notes/" + relative.split( "/" ).map( encodeURIComponent ).join( "/" ),
			{ data: { text: "", keep: false } } )
	}

	await page.goto( "./" )
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
} )

test( "locked to the clip folder and labeled", async ( { page } ) =>
{
	await expect( page.locator( ".topbar .mode-tag" ) ).toHaveText( "TeslaUSB mode" )
	await expect( page.locator( ".folder-button" ) ).toHaveCount( 0 )
	await expect( page.locator( ".trash-button" ) ).toBeVisible()
} )

test( "Keep star and note are saved on the server", async ( { page, request } ) =>
{
	var note = "Test note " + Date.now()

	await h.openEvent( page, h.FOUR_CAMERAS )
	await page.locator( ".keep-button" ).click()
	await expect( page.locator( ".keep-button" ) ).toHaveText( /Kept/ )
	await expect( page.locator( ".chip.kept .count" ) ).toHaveText( "1" )
	await page.locator( "#note" ).fill( note )
	await page.locator( "#note" ).blur()
	await expect.poll( async () => JSON.stringify( await savedNote( request, h.FOUR_CAMERAS ) ) ).toContain( note )

	// A fresh page reads them back from the server.
	await page.reload()
	await expect( page.locator( "#note" ) ).toHaveValue( note )
	await expect( page.locator( ".keep-button" ) ).toHaveText( /Kept/ )
	await expect( h.event( page, h.FOUR_CAMERAS ) ).toContainText( note )

	// Only starred events.
	await page.locator( ".chip.kept" ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( 1 )
	await page.locator( ".chip.kept" ).click()

	// Undo.
	await page.locator( "#note" ).fill( "" )
	await page.locator( "#note" ).blur()
	await page.locator( ".keep-button" ).click()
	await expect( page.locator( ".keep-button" ) ).toHaveText( /Keep/ )
	await expect( page.locator( ".chip.kept .count" ) ).toHaveText( "0" )
} )

test( "Delete moves the event to the trash, Restore brings it back", async ( { page } ) =>
{
	await h.openEvent( page, h.SIX_CAMERAS )
	page.once( "dialog", d => d.accept() )
	await page.getByRole( "button", { name: "Delete event" } ).click()

	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS - 1 )
	await expect( h.event( page, h.SIX_CAMERAS ) ).toHaveCount( 0 )
	await expect( page.locator( ".trash-button .count" ) ).toHaveText( "1" )

	await page.locator( ".trash-button" ).click()
	var item = page.locator( ".trash-item" )

	await expect( item ).toHaveCount( 1 )
	await item.getByRole( "button", { name: "Restore" } ).click()
	await expect( page.locator( ".trash-item" ) ).toHaveCount( 0 )
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
	await expect( h.event( page, h.SIX_CAMERAS ) ).toHaveCount( 1 )
} )

test( "Cancel on the delete question keeps the event", async ( { page } ) =>
{
	await h.openEvent( page, h.FOUR_CAMERAS )
	page.once( "dialog", d => d.dismiss() )
	await page.getByRole( "button", { name: "Delete event" } ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
} )

test( "plays all cameras in step", async ( { page } ) =>
{
	await h.openEvent( page, h.SIX_CAMERAS )
	await h.playInStep( page, 6 )
} )
