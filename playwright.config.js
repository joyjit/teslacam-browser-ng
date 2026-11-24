// Browser tests: click through the page in Google Chrome, the way a person
// would. Each set runs only when its address is given, so the same tests
// check the server started from source and the Docker image:
//
//   SERVER_URL    server in the default mode (open any folder)
//   TESLAUSB_URL  server in TeslaUSB mode (needs a writable copy of the clips)
//   DEMO_URL      the static demo site from scripts/build-demo-site.sh
//   CLIPS         the fake clips (scripts/make-fake-clips.sh), for the
//                 "My USB stick" tests
//
// Run: npx playwright test   (see .github/workflows/ci.yml)
const { defineConfig } = require( "@playwright/test" )

const sets =
[
	{ name: "server", url: process.env.SERVER_URL },
	{ name: "teslausb", url: process.env.TESLAUSB_URL },
	{ name: "demo", url: process.env.DEMO_URL }
]

module.exports = defineConfig(
{
	testDir: "test/e2e",
	// One server per set, and the tests change what it shows: one at a time.
	workers: 1,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	timeout: 60000,
	reporter: process.env.CI ? [ [ "list" ], [ "html", { open: "never" } ] ] : "list",
	use:
	{
		// Google Chrome, not Playwright's own Chromium: that one can't play
		// H.264, the format of the clips.
		channel: "chrome",
		// The server reads clip folder names in its own time zone (UTC in CI).
		timezoneId: process.env.TZ || "UTC",
		trace: "retain-on-failure",
		screenshot: "only-on-failure"
	},
	projects: sets.filter( s => s.url ).map( s => (
	{
		name: s.name,
		testMatch: s.name + ".spec.js",
		use: { baseURL: s.url.replace( /\/?$/, "/" ) }
	} ) )
} )
