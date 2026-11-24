// Shared steps for the browser tests. The fake clips (scripts/make-fake-clips.sh)
// hold six events on four days: three Sentry, two Saved, one Recent.
const base = require( "@playwright/test" )
const { expect } = base

const EVENTS = 6
const DAYS = 4
const SIX_CAMERAS = "SentryClips/2026-11-06_18-31-59"
const FOUR_CAMERAS = "SentryClips/2026-11-03_14-12-20"
const NO_DETAILS = "SavedClips/2026-11-09_11-20-15"

// Every test also fails on a script error in the page.
const test = base.test.extend(
{
	pageErrors: [ async ( { page }, use ) =>
	{
		var errors = []

		page.on( "pageerror", e => errors.push( e.message ) )
		await use( errors )
		expect( errors, "script errors in the page" ).toEqual( [] )
	}, { auto: true } ]
} )

function event( page, relative )
{
	return page.locator( `a.event[href="#${relative}"]` )
}

async function openEvent( page, relative )
{
	await event( page, relative ).click()
	await expect( page.locator( ".player-head .when" ) ).toBeVisible()
}

// The cameras of the clip on screen.
function cameras( page )
{
	return page.locator( ".cams:visible video" )
}

function videoTimes( page )
{
	return page.evaluate( () => Array.from( document.querySelectorAll( ".cams video" ) )
		.filter( v => v.offsetParent ).map( v => v.currentTime ) )
}

async function waitForVideos( page )
{
	await page.waitForFunction( () =>
	{
		var shown = Array.from( document.querySelectorAll( ".cams video" ) ).filter( v => v.offsetParent )

		return shown.length > 0 && shown.every( v => v.readyState >= 2 )
	} )
}

// Press Play, let it run, and check every camera moved and they stay in step.
async function playInStep( page, count )
{
	await expect( cameras( page ) ).toHaveCount( count )
	await waitForVideos( page )
	await page.locator( ".player-bar .play" ).click()
	await page.waitForTimeout( 2000 )

	var times = await videoTimes( page )

	expect( times ).toHaveLength( count )
	expect( Math.min( ...times ), "every camera plays" ).toBeGreaterThan( 0.5 )
	expect( Math.max( ...times ) - Math.min( ...times ), "cameras stay in step" ).toBeLessThan( 0.5 )

	await page.locator( ".player-bar .play" ).click()
	await expect( page.locator( ".player-bar .play .oi-media-play" ) ).toBeVisible()
}

module.exports = { test, expect, EVENTS, DAYS, SIX_CAMERAS, FOUR_CAMERAS, NO_DETAILS,
	event, openEvent, cameras, videoTimes, waitForVideos, playInStep }
