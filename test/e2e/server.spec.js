// The server in its default mode: a USB stick or any folder on the machine.
const h = require( "./helpers" )
const { test, expect } = h

test.beforeEach( async ( { page, request } ) =>
{
	// Another test may have opened a subfolder; start from the clip folder.
	await request.get( "openDefaultFolder" )
	await page.goto( "./" )
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
} )

test( "lists every event, grouped by day, with type counts", async ( { page } ) =>
{
	await expect( page ).toHaveTitle( "TeslaCam Browser NG" )
	await expect( page.locator( ".topbar .version" ) ).toHaveText( require( "../../package.json" ).version )
	await expect( page.locator( "h2.day" ) ).toHaveCount( h.DAYS )
	await expect( page.locator( ".chip.cat-sentry .count" ) ).toHaveText( "3" )
	await expect( page.locator( ".chip.cat-saved .count" ) ).toHaveText( "2" )
	await expect( page.locator( ".chip.cat-recent .count" ) ).toHaveText( "1" )

	// Newest first.
	await expect( page.locator( "a.event" ).first() ).toHaveAttribute( "href", "#RecentClips" )
} )

test( "type filters hide and show events", async ( { page } ) =>
{
	await page.locator( ".chip.cat-sentry" ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS - 3 )
	await page.locator( ".chip.cat-saved" ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( 1 )
	await page.locator( ".chip.cat-sentry" ).click()
	await page.locator( ".chip.cat-saved" ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
} )

test( "plays all six cameras in step, at the chosen speed", async ( { page } ) =>
{
	await h.openEvent( page, h.SIX_CAMERAS )
	await expect( page.locator( ".details" ) ).toContainText( "Testville" )
	await expect( page.locator( ".details" ) ).toContainText( "object detection" )
	await h.playInStep( page, 6 )

	await page.locator( ".player-bar .speed" ).selectOption( "2" )
	var rates = await page.evaluate( () => Array.from( document.querySelectorAll( ".cams video" ) )
		.filter( v => v.offsetParent ).map( v => v.playbackRate ) )
	expect( new Set( rates ) ).toEqual( new Set( [ 2 ] ) )
} )

test( "Jump to event moves every camera to the event", async ( { page } ) =>
{
	await h.openEvent( page, h.FOUR_CAMERAS )
	await h.waitForVideos( page )
	await page.getByRole( "button", { name: "Jump to event" } ).click()

	// The fake event is 2/3 into the first clip.
	await expect.poll( async () => Math.min( ...await h.videoTimes( page ) ) ).toBeGreaterThan( 3 )
	var times = await h.videoTimes( page )
	expect( Math.max( ...times ) - Math.min( ...times ) ).toBeLessThan( 0.5 )
	await expect( page.locator( ".scrub-container .event-marker" ) ).toBeVisible()
} )

test( "clicking a camera enlarges it, clicking again shrinks it", async ( { page } ) =>
{
	await h.openEvent( page, h.FOUR_CAMERAS )
	var cam = page.locator( ".cams:visible .cam" ).first()

	await cam.click()
	await expect( cam ).toHaveClass( /\bbig\b/ )
	await cam.click()
	await expect( cam ).not.toHaveClass( /\bbig\b/ )
} )

test( "an event without event.json still plays", async ( { page } ) =>
{
	await h.openEvent( page, h.NO_DETAILS )
	await expect( page.locator( ".details" ) ).toContainText( "No event details" )
	await h.playInStep( page, 4 )
} )

test( "the folder chooser opens a subfolder and goes back", async ( { page } ) =>
{
	await page.locator( ".folder-button" ).click()
	var folders = page.locator( ".folders a.sub" )

	await expect( folders ).toHaveText( [ /RecentClips/, /SavedClips/, /SentryClips/ ] )
	await folders.filter( { hasText: "SentryClips" } ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( 3 )

	await page.locator( ".folders .crumbs a", { hasText: /^TeslaCam$/ } ).click()
	await expect( page.locator( "a.event" ) ).toHaveCount( h.EVENTS )
	await page.getByRole( "button", { name: "Done" } ).click()
	await expect( page.locator( ".folders" ) ).toHaveCount( 0 )
} )

test( "no notes, stars, trash or delete in this mode", async ( { page } ) =>
{
	await h.openEvent( page, h.FOUR_CAMERAS )
	await expect( page.locator( ".keep-button" ) ).toHaveCount( 0 )
	await expect( page.locator( "#note" ) ).toHaveCount( 0 )
	await expect( page.locator( ".trash-button" ) ).toHaveCount( 0 )
	await expect( page.getByRole( "button", { name: "Delete event" } ) ).toHaveCount( 0 )
} )

test.describe( "on a phone", () =>
{
	test.use( { viewport: { width: 390, height: 844 }, hasTouch: true } )

	test( "list first, then the player, then back", async ( { page } ) =>
	{
		await expect( page.locator( ".events" ) ).toBeVisible()
		await expect( page.locator( ".player" ) ).toBeHidden()

		await h.event( page, h.FOUR_CAMERAS ).tap()
		await expect( page.locator( ".player" ) ).toBeVisible()
		await expect( page.locator( ".events" ) ).toBeHidden()
		await h.playInStep( page, 4 )

		await page.locator( ".player-head .back" ).tap()
		await expect( page.locator( ".events" ) ).toBeVisible()
		await expect( page.locator( ".player" ) ).toBeHidden()
	} )
} )

test( "the old page still loads at /classic", async ( { page } ) =>
{
	var response = await page.goto( "classic" )

	expect( response.status() ).toBe( 200 )
} )
