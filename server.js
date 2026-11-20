// Modules to control application life and create native browser window
const services = require( "./services" )
const fs = require( "fs" )
const express = require( "express" )

const port = 8088
const defaultFolder = ( process.argv.length > 2 ) ? process.argv[ 2 ] : ""

// TESLACAM_LOCK_FOLDER=1 shows only the start folder: no folder picker, and
// the server refuses to open any other folder.
const locked = /^(1|true|yes|on)$/i.test( process.env.TESLACAM_LOCK_FOLDER || "" )

if ( locked && !defaultFolder )
{
	console.error( "TESLACAM_LOCK_FOLDER needs a folder: node server.js /path/to/TeslaCam" )
	process.exit( 1 )
}

services.setVersion( require('./package.json').version )

services.setFolder( defaultFolder )
services.setLocked( locked )
services.initializeExpress( port )
