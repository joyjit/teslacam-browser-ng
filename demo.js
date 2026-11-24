// Calls for the demo site (a static copy, see scripts/build-demo-site.sh).
// Loaded before web.js, which uses window.teslacamHandlers instead of a
// server. Two modes, switched in the top bar:
//
//   archive  the sample clips as a TeslaUSB-mode archive. Notes, Keep stars
//            and the trash are kept in this browser (localStorage) only.
//   usb      the visitor's own TeslaCam folder or USB stick, read by the
//            browser. Nothing is uploaded.
( function ()
{
	var mode = new URLSearchParams( location.search ).get( "mode" ) === "usb" ? "usb" : "archive"
	var demo =
	{
		mode: mode,
		modes: [ { id: "archive", label: "Sample archive (TeslaUSB)" }, { id: "usb", label: "My USB stick" } ],
		note: mode === "usb"
			? "Your clips play in this browser. Nothing is uploaded."
			: "Notes, stars and trash stay in this browser."
	}
	var trashDays = 30
	var version = null

	function encodePath( p )
	{
		return String( p ).split( "/" ).map( encodeURIComponent ).join( "/" )
	}

	function withVersion( done )
	{
		if ( version !== null ) return done()

		$.getJSON( "args", a => { version = a.version; done() } ).fail( () => { version = ""; done() } )
	}

	function setDemoMode( id )
	{
		var url = new URL( location.href )

		if ( id === "usb" ) url.searchParams.set( "mode", "usb" )
		else url.searchParams.delete( "mode" )

		url.hash = ""
		location.href = url.toString()
	}

	// ---------- Sample archive: TeslaUSB mode, state in localStorage ----------

	function load( key, fallback )
	{
		try { return JSON.parse( localStorage.getItem( key ) ) || fallback }
		catch ( e ) { return fallback }
	}

	function store( key, value )
	{
		try { localStorage.setItem( key, JSON.stringify( value ) ); return true }
		catch ( e ) { return false }
	}

	var storageOk = store( "demo-check", 1 )
	var notesKey = "demo-notes"
	var trashKey = "demo-trash"

	function trashItems()
	{
		var now = Date.now()
		var items = load( trashKey, [] ).filter( t => new Date( t.purgeAt ).getTime() > now )

		return items.sort( ( a, b ) => b.deletedAt.localeCompare( a.deletedAt ) )
	}

	function notesState()
	{
		return { enabled: true, writable: storageOk, error: storageOk ? null : "This browser can't keep notes (storage is off)." }
	}

	var snapshot = null

	function archiveArgs( done )
	{
		if ( !snapshot ) return $.getJSON( "openDefaultFolder", a => { snapshot = a; archiveArgs( done ) } )

		var gone = new Set( trashItems().map( t => t.relative ) )

		done( Object.assign( {}, snapshot,
			{
				folderInfos: snapshot.folderInfos.filter( f => !gone.has( f.relative ) ),
				locked: true,
				mode: "teslausb",
				notes: notesState(),
				trash: { enabled: storageOk, days: trashDays },
				demo: demo
			} ) )
	}

	var archiveHandlers =
	{
		openFolder: ( p, done ) => archiveArgs( done ),
		reopen: done => archiveArgs( done ),
		getFiles: ( p, done ) => $.getJSON( "files/" + encodePath( p ), done ),
		fileUrl: ( args, relative ) => "videos/" + encodePath( relative ),
		getNotes: done => done( Object.assign( { notes: load( notesKey, {} ) }, notesState() ) ),
		saveNote: ( relative, note, done, fail ) =>
		{
			var notes = load( notesKey, {} )
			var text = String( note && note.text || "" )
			var keep = !!( note && note.keep )

			if ( text.trim() || keep ) notes[ relative ] = { text: text, keep: keep, by: null, at: new Date().toISOString() }
			else delete notes[ relative ]

			if ( !store( notesKey, notes ) ) return fail( "This browser can't keep notes" )

			done( notes[ relative ] || null )
		},
		getTrash: done => done( { items: trashItems(), days: trashDays } ),
		trash: ( action, body, done, fail ) =>
		{
			var items = trashItems()

			if ( !action )
			{
				var deletedAt = new Date()

				items.push(
					{
						id: deletedAt.getTime().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 ),
						relative: body.relative,
						deletedAt: deletedAt.toISOString(),
						by: null,
						purgeAt: new Date( deletedAt.getTime() + trashDays * 86400000 ).toISOString()
					} )
			}
			else
			{
				var item = items.find( t => t.id === body.id )

				if ( !item ) return fail( "Not in the trash" )

				items = items.filter( t => t !== item )

				// Removed for good: its note goes too, as on a real server.
				if ( action === "purge" )
				{
					var notes = load( notesKey, {} )

					delete notes[ item.relative ]
					store( notesKey, notes )
				}
			}

			if ( !store( trashKey, items ) ) return fail( "This browser can't keep the trash" )

			done( {} )
		},
		openBrowser: () => {},
		openExternal: () => {}
	}

	// ---------- My USB stick: a folder the visitor picks, read in the browser ----------

	var files = new Map()   // "Stick/TeslaCam/.../x.mp4" -> File
	var dirs = new Map()    // "Stick/TeslaCam" -> Set of names inside
	var events = new Map()  // event folder path -> parsed event.json
	var urls = new Map()    // file path -> object URL
	var current = ""        // the folder shown, inside the picked one

	var fsx =
	{
		list: p =>
		{
			if ( !dirs.has( p ) ) throw new Error( "No folder " + p )

			return Array.from( dirs.get( p ) )
		},
		isDir: p => dirs.has( p ),
		exists: p => files.has( p ),
		readEvent: p => events.get( p ) || null,
		join: ( a, b ) => a ? a + "/" + b : b,
		relative: ( from, to ) => to.startsWith( from + "/" ) ? to.slice( from.length + 1 ) : to
	}

	// entries: [ { path: "Stick/TeslaCam/.../x.mp4", file: File } ]
	function index( entries )
	{
		urls.forEach( u => URL.revokeObjectURL( u ) )
		files = new Map()
		dirs = new Map()
		events = new Map()
		urls = new Map()

		for ( var entry of entries )
		{
			var parts = entry.path.split( "/" )

			files.set( entry.path, entry.file )

			for ( var i = 1; i < parts.length; i++ )
			{
				var dir = parts.slice( 0, i ).join( "/" )

				if ( !dirs.has( dir ) ) dirs.set( dir, new Set() )
				dirs.get( dir ).add( parts[ i ] )
			}
		}

		var reads = []

		files.forEach( ( file, p ) =>
		{
			if ( !/\/event\.json$/.test( p ) ) return

			reads.push( file.text()
				.then( text => events.set( p.slice( 0, -"/event.json".length ), JSON.parse( text ) ) )
				.catch( () => {} ) )
		} )

		return Promise.all( reads )
	}

	function usbArgs()
	{
		var parts = current ? current.split( "/" ) : []
		var folderInfos = current ? helpers.findEvents( current, fsx ) : []

		return {
			folder: current,
			folderInfos: folderInfos,
			folderPathParts: parts.map( ( name, i ) => ( { path: parts.slice( 0, i + 1 ).join( "/" ), name: name } ) ),
			subfolders: current
				? fsx.list( current ).filter( n => dirs.has( current + "/" + n ) ).sort()
					.map( n => ( { path: current + "/" + n, name: n } ) )
				: [],
			locked: false,
			mode: "",
			notes: { enabled: false, writable: false, error: null },
			trash: { enabled: false, days: trashDays },
			version: version,
			demo: demo
		}
	}

	// Every file under a folder the File System Access picker returned. Hidden
	// folders (".Trashes", ".Spotlight-V100", ...) are skipped.
	async function walk( handle, prefix, out )
	{
		var waits = []

		for await ( var [ name, child ] of handle.entries() )
		{
			if ( name.startsWith( "." ) ) continue

			var p = prefix + "/" + name

			if ( child.kind === "directory" ) waits.push( walk( child, p, out ) )
			else waits.push( child.getFile().then( file => out.push( { path: p, file: file } ), () => {} ) )
		}

		await Promise.all( waits )

		return out
	}

	function opened( entries, done )
	{
		if ( !entries.length ) return

		index( entries ).then( () =>
		{
			current = Array.from( dirs.keys() ).sort( ( a, b ) => a.length - b.length )[ 0 ] || ""
			done( usbArgs() )
		} )
	}

	function pickFolder( done )
	{
		// Chrome and Edge: asks to let the page view the folder. The older
		// picker below makes Chrome ask to "upload" the files, which they never are.
		if ( window.showDirectoryPicker )
		{
			window.showDirectoryPicker( { id: "teslacam", mode: "read" } )
				.then( dir => walk( dir, dir.name, [] ) )
				.then( entries => opened( entries, done ), () => {} )
			return
		}

		var input = document.createElement( "input" )

		input.type = "file"
		input.multiple = true
		input.webkitdirectory = true
		input.addEventListener( "change", () =>
			opened( Array.from( input.files, f => ( { path: f.webkitRelativePath || f.name, file: f } ) ), done ) )
		input.click()
	}

	function fileUrl( p )
	{
		var file = files.get( p )

		if ( !file ) return ""
		if ( !urls.has( p ) ) urls.set( p, URL.createObjectURL( file ) )

		return urls.get( p )
	}

	var usbHandlers =
	{
		openFolder: ( p, done ) =>
		{
			// Nothing picked yet, and the page asks to browse: pick instead.
			if ( p && !dirs.size ) return pickFolder( done )
			if ( p && dirs.has( p ) ) current = p

			withVersion( () => done( usbArgs() ) )
		},
		chooseFolder: pickFolder,
		reopen: done => done( usbArgs() ),
		getFiles: ( p, done ) =>
		{
			var dir = fsx.join( current, p )

			done(
				{
					clips: Array.from( helpers.groupFiles( p, dirs.has( dir ) ? fsx.list( dir ) : [], f => fileUrl( fsx.join( current, f ) ) ) ),
					event: events.get( dir ) || null
				} )
		},
		fileUrl: ( args, relative ) => fileUrl( fsx.join( current, relative ) ),
		openBrowser: () => {},
		openExternal: () => {}
	}

	window.teslacamHandlers = Object.assign( { setDemoMode: setDemoMode }, mode === "usb" ? usbHandlers : archiveHandlers )
} )()
