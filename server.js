// Modules to control application life and create native browser window
const services = require( "./services" )
const fs = require( "fs" )
const express = require( "express" )

// PORT=<number> to listen somewhere other than 8088.
const port = Number( process.env.PORT ) || 8088
const defaultFolder = ( process.argv.length > 2 ) ? process.argv[ 2 ] : ""

// TESLACAM_MODE=teslausb: a fixed clip archive. Only the start folder (no
// folder list, other folders refused), and notes per event, kept in
// <folder>/.teslacam-browser/notes.json. See README.
const mode = process.env.TESLACAM_MODE || ""

if ( mode && !defaultFolder )
{
	console.error( "TESLACAM_MODE needs a folder: node server.js /path/to/TeslaCam" )
	process.exit( 1 )
}

services.setVersion( require('./package.json').version )

services.setFolder( defaultFolder )

try
{
	services.setMode( mode )
}
catch ( e )
{
	console.error( e.message )
	process.exit( 1 )
}

services.initializeExpress( port )
