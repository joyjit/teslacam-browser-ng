( function ( root, factory )
{
	if ( typeof define === 'function' && define.amd ) define( [ "./helpers", "fs", "path", "express", "serve-index" ], factory );
	else if ( typeof exports === 'object' ) module.exports = factory( require( "./helpers" ), require( "fs" ), require( "path" ), require( "express" ), require( "serve-index" ) );
	else root.services = factory( root.helpers, root.fs, root.path, root.express, root.serveIndex );
}( typeof self !== 'undefined' ? self : this, function ( helpers, fs, path, express, serveIndex )
{
	const expressApp = express()
	var version = "0.0.1"
	var lastArgs = { version: version, folder: "", locked: false, mode: "" }

	// Modes, set by whoever runs the server (e.g. in a Docker compose file):
	// ""        the default: the page has a folder list, no notes.
	// teslausb  a fixed clip archive (e.g. uploaded by TeslaUSB): only the start
	//           folder (no folder list), and notes per event.
	var modes = [ "", "teslausb" ]
	var mode = ""
	var locked = false

	function setMode( m )
	{
		m = String( m || "" ).trim().toLowerCase()

		if ( !modes.includes( m ) ) throw new Error( `Unknown mode "${m}"; use one of: ${modes.filter( Boolean ).join( ", " )}` )

		mode = m
		locked = ( mode === "teslausb" )
		lastArgs.locked = locked
		lastArgs.mode = mode
		console.log( "Mode: " + ( mode || "default (folder list)" ) )

		if ( mode === "teslausb" ) loadNotes()
	}

	// Notes (TeslaUSB mode): one JSON file in a hidden folder at the top of the
	// clip folder, keyed by the event's folder path (e.g.
	// "SentryClips/2026-11-19_15-30-11"), which comes from the event's time and
	// so stays the same in every copy of the clips.
	var notes = {}
	var notesError = null

	function notesFile()
	{
		return path.join( lastArgs.folder, ".teslacam-browser", "notes.json" )
	}

	function loadNotes()
	{
		notes = {}
		notesError = null

		var file = notesFile()

		try
		{
			if ( fs.existsSync( file ) ) notes = JSON.parse( fs.readFileSync( file, "utf8" ) ).notes || {}
		}
		catch ( e )
		{
			// Never overwrite a file we could not read.
			notesError = `Can't read ${file}: ${e.message}`
			console.error( notesError )
			return
		}

		try
		{
			fs.mkdirSync( path.dirname( file ), { recursive: true } )
			fs.accessSync( path.dirname( file ), fs.constants.W_OK )
		}
		catch ( e )
		{
			notesError = `Notes can't be saved: ${path.dirname( file )} is not writable`
			console.error( notesError )
		}
	}

	function notesState()
	{
		return { enabled: mode === "teslausb", writable: mode === "teslausb" && !notesError, error: notesError }
	}

	function getNotes()
	{
		return Object.assign( { notes: notes }, notesState() )
	}

	// Save one event's note; an empty note without Keep removes it.
	function saveNote( relative, note, user )
	{
		if ( !notesState().writable ) throw new Error( notesError || "Notes are off" )

		var key = String( relative ).replace( /^[\\/]+/, "" )
		var text = String( note && note.text || "" )
		var keep = !!( note && note.keep )

		if ( text.length > 20000 ) throw new Error( "Note too long" )

		var next = Object.assign( {}, notes )

		if ( text.trim() || keep ) next[ key ] = { text: text, keep: keep, by: user || null, at: new Date().toISOString() }
		else delete next[ key ]

		// Write a new file, then swap it in, so a crash never leaves half a file.
		var file = notesFile()
		var temp = file + ".tmp"

		fs.writeFileSync( temp, JSON.stringify( { version: 1, notes: next }, null, 1 ) )
		fs.renameSync( temp, file )

		notes = next

		return notes[ key ] || null
	}

	function realPath( p )
	{
		try { return fs.realpathSync( p ) }
		catch ( e ) { return path.resolve( p ) }
	}

	// The absolute path of p, read relative to the open folder, if it is the
	// open folder or inside it after resolving ".." and symbolic links;
	// otherwise null.
	function insideFolder( p )
	{
		if ( !lastArgs.folder || typeof p !== "string" ) return null

		var root = realPath( lastArgs.folder )
		var target = realPath( path.join( root, p ) )

		if ( target === root || target.startsWith( root.endsWith( path.sep ) ? root : root + path.sep ) ) return target

		return null
	}

	function installRangeHandler()
	{
		// Empty or still-growing clips make `send` reject the byte range (#27).
		// Registered after each /videos mount so it sits later in the stack than that static middleware.
		expressApp.use( ( err, request, response, next ) =>
		{
			var status = err && ( err.status || err.statusCode )

			if ( status === 416 )
			{
				if ( !response.headersSent ) response.status( 416 ).type( "txt" ).send( "Range not satisfiable" )

				return
			}

			next( err )
		} )
	}

    function setVersion( v )
    {
		version = v
		lastArgs.version = v
		console.log( "TeslaCam Browser version set to " + v )
    }

	function setFolder( f )
	{
		lastArgs.folder = f
		console.log( "Root folder set to " + f )
	}

	function reopenFolders()
	{
		if ( lastArgs && lastArgs.folder ) return openFolder( lastArgs.folder )

		return lastArgs
	}

	function openFolders( folders )
	{
		if ( folders && folders.length > 0 )
		{
            var folder = folders[ 0 ] + "/"

            Object.assign( lastArgs, openFolder( folder ) )
		}

		return lastArgs
	}

	function args()
	{
		return lastArgs
	}

	function getEventMetadata( folderPath )
	{
		try
		{
			var eventFile = path.join( folderPath, "event.json" )
			if ( fs.existsSync( eventFile ) )
			{
				var content = fs.readFileSync( eventFile, "utf8" )
				return JSON.parse( content )
			}
		}
		catch ( e )
		{
			console.log( "Could not read event.json: " + e.message )
		}
		return null
	}

	function getFiles( p, getVideoPath )
	{
		var folder = path.join( lastArgs.folder, p )
		var files = fs.readdirSync( folder )
		var eventMeta = getEventMetadata( folder )

		return { clips: Array.from( helpers.groupFiles( p, files, getVideoPath ) ), event: eventMeta }
	}

	function deleteFiles( files )
	{
		if ( !files || typeof files.length !== "number" || files.length < 1 ) return

		console.log( `Deleting files: ${files}` )

		for ( var file of files ) fs.unlinkSync( file )

		console.log( `Deleted files: ${files}` )

		var folderPath = path.dirname( files[ 0 ] )
		var files = fs.readdirSync( folderPath )

		if ( files.length < 1 )
		{
			console.log( `Deleting folder: ${folderPath}` )

			fs.rmdirSync( folderPath )

			console.log( `Deleted folder: ${folderPath}` )
		}
	}

	function deleteFolder( folder )
	{
		var folderPath = path.join( lastArgs.folder, folder )
		var files = fs.readdirSync( folderPath )

		deleteFiles( files.map( f => path.join( folderPath, f ) ) )
	}

	function copyFilePaths( filePaths )
	{
		return filePaths.map( f => `"${path.join( lastArgs.folder, f )}"` ).join( " " )
	}

	function copyPath( folderPath )
	{
		return path.join( lastArgs.folder, folderPath )
	}

	function openFolder( folder )
	{
		if ( !folder ) folder = lastArgs.folder

		if ( !folder )
		{
			return {
				folder: "",
				folderInfos: [],
				dateGroups: [],
				dates: [],
				parsedFolder: path.parse( "" ),
				folderPathParts: [],
				subfolders: [],
				locked: locked,
				mode: mode,
				notes: notesState(),
				version: version
			}
		}

		var specialFolders = [ "TeslaCam", "SavedClips", "RecentClips", "SentryClips", "TeslaSentry", "TrackMode" ]
		var categoryNames = { SavedClips: "Saved", RecentClips: "Recent", SentryClips: "Sentry", TeslaSentry: "Sentry", TrackMode: "Track" }
		var folderInfos = []

		function addSubfolders( baseFolder, category )
		{
			try
			{
				var subfolders = fs.readdirSync( baseFolder )

				for ( var subfolder of subfolders )
				{
					if ( specialFolders.includes( subfolder ) )
					{
						var nextCategory = categoryNames[ subfolder ] || category

						addSubfolders( path.join( baseFolder, subfolder ), nextCategory )
					}
					else
					{
						var match = helpers.matchFolder( subfolder )
					
						if ( match && match.length > 0 )
						{
							function addFolder( match )
							{
								var date = helpers.extractDate( match )
								var folderPath = path.join( baseFolder, subfolder )
								var relative = path.relative( folder, folderPath )
						
								var eventMeta = getEventMetadata( folderPath )
								var thumb = fs.existsSync( path.join( folderPath, "thumb.png" ) )
								folderInfos.push( { date: date, path: folderPath, relative: relative, recent: false, event: eventMeta, category: category, thumb: thumb } )
							}

							addFolder( match )
						}
						else
						{
							var clipMatch = helpers.matchClip( subfolder )

							if ( clipMatch && clipMatch.length > 0 )
							{
								var date = helpers.extractDate( clipMatch )
								var existing = folderInfos.find( i => i.path == baseFolder )

								if ( existing )
								{
									if ( date > existing.date ) existing.date = date
								}
								else
								{
									var relative = path.relative( folder, baseFolder )

									var clipEventMeta = getEventMetadata( baseFolder )
									folderInfos.push( { date: date, path: baseFolder, relative: relative, recent: true, event: clipEventMeta, category: category } )
								}
							}
							else if ( /^\d{4}-\d{2}-\d{2}$/.test( subfolder ) )
							{
								// RecentClips sometimes nests clips in a date folder
								// (RecentClips/2023-12-04/2023-12-04_12-23-59-front.mp4).
								// Only those date folders are walked, not every directory on the drive.
								try
								{
									var datedPath = path.join( baseFolder, subfolder )

									if ( fs.lstatSync( datedPath ).isDirectory() ) addSubfolders( datedPath, category )
								}
								catch ( e )
								{
									console.error( e && e.message ? e.message : e )
								}
							}
						}
					}
				}
			}
			catch (e)
			{
				console.error( e && e.message ? e.message : e )
			}
		}

		folder = path.normalize( ( folder || "" ) + path.sep )

		addSubfolders( folder, null )

		var dateGroups = helpers.groupBy( folderInfos, g => g.date.toDateString() )
		var dates = Array.from( dateGroups.keys() ).map( d => new Date( d ) )
		var parsedFolder = path.parse( folder )

		var folderNames = [ parsedFolder.root ]
			.concat( parsedFolder.dir.replace( parsedFolder.root, "" ).split( path.sep ) )
			.concat( [ parsedFolder.base ] )
			.filter( f => f.length > 0 )

		var folderPathParts = folderNames
			.map( ( f, i ) => { return { path: path.join( ...folderNames.slice( 0, i + 1 ) ), name: f } } )

		//console.log( parsedFolder )
		//console.log( folderNames )
		//console.log( folderPathParts )

		function isDirectory( p )
		{
			try
			{
				return fs.lstatSync( p ).isDirectory()
			}
			catch (e)
			{
				return false
			}
		}

		var subfolders = []

		try
		{
			subfolders = fs.readdirSync( folder )
				.map( f => { return { path: path.join( folder, f ), name: f } } )
				.filter( f => isDirectory( f.path ) )
		}
		catch (e)
		{
			console.error( e && e.message ? e.message : e )
		}

		return {
			folder: folder,
			folderInfos: folderInfos,
			dateGroups: Array.from( dateGroups ),
            dates: dates,
            parsedFolder: parsedFolder,
			folderPathParts: folderPathParts,
			subfolders: subfolders,
			locked: locked,
			mode: mode,
			notes: notesState(),
			version: version
        }
    }

    function initializeExpress( port )
    {
		var startFolder = lastArgs.folder

		function serveVideos( args )
		{
			lastArgs = args

			console.log( ` ${args.folder}` )

			return args
		}

		function samePath( a, b )
		{
			return realPath( a ) === realPath( b )
		}

		function refuse( response, message )
		{
			response.status( 403 ).type( "txt" ).send( message )
		}

		// Videos and thumbnails come from the open folder only. One handler that
		// follows the open folder, instead of a new one for every folder opened.
		var videoFolder = null
		var videoHandlers = []

		expressApp.use( "/videos", ( request, response, next ) =>
		{
			if ( !lastArgs.folder ) return next()

			if ( videoFolder !== lastArgs.folder )
			{
				videoFolder = lastArgs.folder
				videoHandlers = [ express.static( videoFolder ), serveIndex( videoFolder, { 'icons': true } ) ]
			}

			videoHandlers[ 0 ]( request, response, err => err ? next( err ) : videoHandlers[ 1 ]( request, response, next ) )
		} )

		installRangeHandler()

		expressApp.use( express.json( { limit: "1mb" } ) )
		expressApp.use( express.urlencoded( { extended: false, limit: "1mb" } ) )

        expressApp.get( "/", ( request, response ) => response.sendFile( __dirname + "/web.html" ) )
        expressApp.get( "/classic", ( request, response ) => response.sendFile( __dirname + "/external.html" ) )
        expressApp.get( "/openFolders", ( request, response ) => response.send( openFolders() ) )
        expressApp.get( "/reopenFolders", ( request, response ) => response.send( reopenFolders() ) )
        expressApp.get( "/args", ( request, response ) => response.send( args() ) )
        expressApp.get( "/openDefaultFolder", ( request, response ) => response.send( serveVideos( openFolder() ) ) )
        expressApp.use( "/openFolder", ( request, response ) =>
		{
			var folder = decodeURIComponent( request.path )

			if ( locked && !samePath( folder, startFolder ) ) return refuse( response, "The folder is locked" )

			response.send( serveVideos( openFolder( folder ) ) )
		} )
        expressApp.use( "/copyFilePaths", ( request, response ) => response.send( copyFilePaths( decodeURIComponent( request.path ) ) ) )
        expressApp.use( "/copyPath", ( request, response ) => response.send( copyPath( decodeURIComponent( request.path ) ) ) )
        expressApp.use( "/files", ( request, response ) =>
		{
			var folder = decodeURIComponent( request.path )

			if ( insideFolder( folder ) == null ) return refuse( response, "Outside the open folder" )

			response.send( getFiles( folder, p => "videos/" + p ) )
		} )

        expressApp.post( "/deleteFiles", ( request, response ) =>
		{
			// Paths as the page has them: relative to the open folder.
			var files = ( Array.isArray( request.body ) ? request.body : [] ).map( insideFolder )

			if ( files.length < 1 || files.includes( null ) ) return refuse( response, "Outside the open folder" )

			deleteFiles( files )
			response.sendStatus( 204 )
		} )
        expressApp.post( "/deleteFolder", ( request, response ) =>
		{
			var folder = typeof request.body === "string" ? request.body : request.body && request.body.folder

			var target = insideFolder( folder )

			// Never the open folder itself, only an event folder inside it.
			if ( target == null || samePath( target, lastArgs.folder ) )
			{
				return refuse( response, "Outside the open folder" )
			}

			deleteFolder( folder )
			response.sendStatus( 204 )
		} )

        // Notes (TeslaUSB mode). Who wrote a note comes from the login in front
        // of the server (Authelia's Remote-User header), if there is one.
        expressApp.get( "/notes", ( request, response ) => response.send( getNotes() ) )
        expressApp.put( /^\/notes\/(.+)$/, ( request, response ) =>
		{
			var relative = decodeURIComponent( request.params[ 0 ] )
			var target = insideFolder( relative )

			if ( target == null || samePath( target, lastArgs.folder ) ) return refuse( response, "Outside the open folder" )

			try
			{
				response.send( { note: saveNote( relative, request.body, request.get( "Remote-User" ) ) } )
			}
			catch ( e )
			{
				response.status( 500 ).type( "txt" ).send( e.message )
			}
		} )

        expressApp.use( "/content", express.static( __dirname ) )
        expressApp.use( "/node_modules", express.static( __dirname + "/node_modules" ) )
        // The new page uses plain relative paths (web.css, ui.js), so the same
        // file works from disk in the desktop app and from this server.
        expressApp.use( "/", express.static( __dirname, { index: false } ) )

        expressApp.listen( port, ( err ) =>
        {
            if (err)
            {
                return console.log( `Something bad happened`, err )
            }
    
            console.log( `Server is listening on port ${port}` )
        } )
    }

	return {
		setVersion: setVersion,
		setFolder: setFolder,
		setMode: setMode,
		getNotes: getNotes,
		saveNote: saveNote,
		insideFolder: insideFolder,
        openFolders: openFolders,
        reopenFolders: reopenFolders,
        openFolder: openFolder,
		args: args,
		getFiles: getFiles,
		getEventMetadata: getEventMetadata,
        deleteFiles: deleteFiles,
        copyFilePaths: copyFilePaths,
        deleteFolder: deleteFolder,
        copyPath: copyPath,
        initializeExpress: initializeExpress,
        openFolder: openFolder
	}
} ) );
