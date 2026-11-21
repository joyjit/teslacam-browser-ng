// The web page (server mode): event list on the left, cameras laid out like
// the car on the right, one player bar. Playback and camera sync come from
// ui.js (createPlayerMixin, SynchronizedVideo), shared with the desktop page.
( function ()
{
	// The desktop app (preload.js) provides window.teslacam; in a browser the
	// same calls go to the server.
	var api = window.teslacam
	var desktop = !!api

	function encodePath( p )
	{
		return String( p ).split( "/" ).map( encodeURIComponent ).join( "/" )
	}

	function joinPath( folder, relative )
	{
		return String( folder || "" ).replace( /[\\/]+$/, "" ) + "/" + relative
	}

	var handlers = desktop
		? {
			openFolder: ( p, done ) => done( api.openFolder( p ) ),
			chooseFolder: done => done( api.openFolders() ),
			reopen: done => done( api.reopenFolders() ),
			getFiles: ( p, done ) => done( api.getFiles( p ) ),
			fileUrl: ( args, relative ) => joinPath( args.folder, relative ),
			deleteFolder: ( relative, done ) => { api.deleteFolder( relative ); done() },
			copyPath: ( args, relative ) => api.copyPath( relative ),
			showInFolder: ( args, relative ) => api.openExternal( joinPath( args.folder, relative ) ),
			openBrowser: () => api.openBrowser(),
			// A click on a video enlarges the camera instead of opening the file.
			openExternal: () => {}
		}
		: {
			openFolder: ( p, done ) => $.getJSON( p ? "openFolder" + encodePath( p ) : "openDefaultFolder", done ),
			reopen: done => $.getJSON( "reopenFolders", done ),
			getFiles: ( p, done ) => $.getJSON( "files/" + encodePath( p ), done ),
			fileUrl: ( args, relative ) => "videos/" + encodePath( relative ),
			copyPath: ( args, relative ) => navigator.clipboard && navigator.clipboard.writeText( joinPath( args.folder, relative ) ),
			getNotes: done => $.getJSON( "notes", done ),
			saveNote: ( relative, note, done, fail ) => $.ajax(
				{
					url: "notes/" + encodePath( relative ),
					method: "PUT",
					contentType: "application/json",
					data: JSON.stringify( note ),
					success: r => done( r.note ),
					error: x => fail( x.responseText || x.statusText || "No answer from the server" )
				} ),
			openBrowser: () => {},
			openExternal: () => {}
		}

	function words( value )
	{
		// "sentry_aware_object_detection" -> "Sentry aware object detection"
		var text = String( value ).replace( /_/g, " " ).trim()

		return text.charAt( 0 ).toUpperCase() + text.slice( 1 )
	}

	// Where each camera sits, seen from above with the car facing up:
	// [ row, column ]. Pillars look forward-sideways, so they sit beside the
	// front camera; repeaters look backward, so they sit beside the back one.
	// Without pillars, the repeaters move up beside the front camera.
	var slots =
	{
		front: [ 1, 2 ],
		back: [ 2, 2 ],
		left_pillar: [ 1, 1 ],
		right_pillar: [ 1, 3 ],
		left_repeater: [ 2, 1 ],
		right_repeater: [ 2, 3 ]
	}

	function layout( views )
	{
		var cameras = views.map( v => v.camera )
		var pillars = cameras.some( c => /_pillar$/.test( c ) )
		var extraColumns = [ 2, 1, 3 ]
		var extras = 0
		var places = {}

		for ( var camera of cameras )
		{
			var slot = slots[ camera ]

			if ( slot && !pillars && /_repeater$/.test( camera ) ) slot = [ 1, slot[ 1 ] ]

			// Anything else (cabin, new cameras) goes in a row below.
			if ( !slot ) slot = [ 3 + Math.floor( extras / 3 ), extraColumns[ extras++ % 3 ] ]

			places[ camera ] = slot
		}

		return places
	}

	ui.createVideoComponent( handlers )

	Vue.component( "CarView",
	{
		props: [ "controls", "timespans", "focus", "forceFocus" ],
		template:
			`<div class="car-view">
				<div v-for="timespan in timespans" v-show="timespan === controls.timespan" class="cams"
					:class="{ focused: big( timespan ) != null }">
					<div v-for="view in timespan.views" :key="view.camera" class="cam"
						:class="{ big: view.camera === big( timespan ) }" :style="place( timespan, view )"
						@click="$emit( 'focus', view.camera === big( timespan ) && !forceFocus ? null : view.camera )">
						<synchronized-video :timespan="timespan" :view="view" :playbackRate="controls.speed"></synchronized-video>
						<span class="cam-label">{{ label( view.camera ) }}</span>
					</div>
				</div>
				<div class="alert alert-danger" v-if="controls.timespan && controls.timespan.playbackError">
					{{ controls.timespan.playbackError }}
				</div>
			</div>`,
		watch:
		{
			// Same as VideoGroup in ui.js: the one Play button drives the current clip.
			"controls.playing": function( playing )
			{
				for ( var timespan of this.timespans )
				{
					timespan.ended = false
					timespan.playing = ( timespan == this.controls.timespan ) ? playing : false
				}
			}
		},
		methods:
		{
			big: function( timespan )
			{
				var cameras = timespan.views.map( v => v.camera )

				if ( cameras.includes( this.focus ) ) return this.focus
				if ( !this.forceFocus || cameras.length === 0 ) return null

				return cameras.includes( "front" ) ? "front" : cameras[ 0 ]
			},
			place: function( timespan, view )
			{
				var slot = layout( timespan.views )[ view.camera ]
				var order = ( slot[ 0 ] - 1 ) * 3 + slot[ 1 ]

				// Enlarged: one big camera on top, the rest in a strip in car order.
				if ( this.big( timespan ) != null ) return { order: view.camera === this.big( timespan ) ? 0 : order }

				return { gridRow: slot[ 0 ], gridColumn: slot[ 1 ] }
			},
			label: words
		}
	} )

	var phone = window.matchMedia( "(max-width: 767.98px)" )

	var vueApp = new Vue(
	{
		el: "#root",
		mixins: [ ui.createPlayerMixin( handlers ) ],
		data:
		{
			args: { version: null, folderInfos: null },
			hidden: [],
			selected: null,
			focus: null,
			fromList: false,
			isPhone: phone.matches,
			picker: null,
			showFolders: false,
			desktop: desktop,
			canDelete: !!handlers.deleteFolder,
			canChoose: !!handlers.chooseFolder,
			canShow: !!handlers.showInFolder,
			copied: false,
			notes: {},
			onlyKept: false,
			noteText: "",
			noteKeep: false,
			noteStatus: "",
			noteTimer: null,
			noteKey: null
		},
		computed:
		{
			"args.notes.enabled": function( on )
			{
				if ( on && handlers.getNotes ) handlers.getNotes( r =>
				{
					this.notes = r.notes || {}
					this.showNote( this.selected )
				} )
			},
			events: function()
			{
				return ( this.args.folderInfos || [] )
					.slice()
					.sort( ( a, b ) => new Date( b.date ) - new Date( a.date ) )
			},
			categories: function()
			{
				var counts = new Map()

				for ( var e of this.events )
				{
					var c = this.categoryOf( e )

					counts.set( c, ( counts.get( c ) || 0 ) + 1 )
				}

				return Array.from( counts, ( [ name, count ] ) => ( { name: name, count: count } ) )
			},
			days: function()
			{
				var days = []
				var byKey = new Map()

				for ( var e of this.events )
				{
					if ( this.hidden.includes( this.categoryOf( e ) ) ) continue
					if ( this.onlyKept && !( this.noteOf( e ) && this.noteOf( e ).keep ) ) continue

					var key = new Date( e.date ).toDateString()
					var day = byKey.get( key )

					if ( !day )
					{
						day = { key: key, label: this.dayLabel( e.date ), events: [] }
						byKey.set( key, day )
						days.push( day )
					}

					day.events.push( e )
				}

				return days
			},
			clockText: function()
			{
				var time = this.timespanTime( this.controls.timespan )

				return time ? time.toLocaleTimeString() : "--:--:--"
			},
			notesOn: function()
			{
				return !!( this.args.notes && this.args.notes.enabled && handlers.getNotes )
			},
			notesWritable: function()
			{
				return this.notesOn && this.args.notes.writable
			},
			keptCount: function()
			{
				return this.events.filter( e => this.noteOf( e ) && this.noteOf( e ).keep ).length
			},
			folderName: function()
			{
				var parts = this.args.folderPathParts || []

				return parts.length ? parts[ parts.length - 1 ].name : ""
			},
			elapsedText: function()
			{
				function mmss( s )
				{
					s = Math.max( 0, Math.floor( Number( s ) || 0 ) )

					return Math.floor( s / 60 ) + ":" + String( s % 60 ).padStart( 2, "0" )
				}

				return mmss( this.currentTime ) + " / " + mmss( this.duration )
			}
		},
		watch:
		{
			"args.notes.enabled": function( on )
			{
				if ( on && handlers.getNotes ) handlers.getNotes( r =>
				{
					this.notes = r.notes || {}
					this.showNote( this.selected )
				} )
			},
			events: function()
			{
				this.selectFromHash()
				this.$nextTick( () => this.setUpPicker() )
			},
			selected: function( e, old )
			{
				if ( e === old ) return

				this.focus = null
				this.controls.playing = false
				this.loadEvent( e ? e.relative : null )
				this.flushNote()
				this.showNote( e )
			}
		},
		created: function()
		{
			handlers.openFolder( null, a => this.args = a )

			// File > Open Folder... in the desktop app's menu.
			if ( api && api.onFolderOpened ) api.onFolderOpened( a => this.args = a )

			window.addEventListener( "hashchange", () => this.selectFromHash() )
			phone.addEventListener( "change", m => this.isPhone = m.matches )
			document.addEventListener( "keydown", e => this.key( e ) )
		},
		methods:
		{
			words: words,
			categoryOf: function( e )
			{
				return e.category || ( e.recent ? "Recent" : "Other" )
			},
			placeOf: function( meta )
			{
				return meta ? [ meta.street, meta.city ].filter( Boolean ).join( ", " ) : ""
			},
			thumbUrl: function( e )
			{
				return handlers.fileUrl( this.args, e.relative + "/thumb.png" )
			},
			noteOf: function( e )
			{
				return e ? this.notes[ e.relative ] || null : null
			},
			showNote: function( e )
			{
				var note = this.noteOf( e )

				this.noteText = note ? note.text : ""
				this.noteKeep = note ? note.keep : false
				this.noteStatus = this.noteSummary( note )
			},
			noteSummary: function( note )
			{
				if ( !note ) return ""

				var when = new Date( note.at ).toLocaleString( [], { dateStyle: "medium", timeStyle: "short" } )

				return "Last edited " + ( note.by ? "by " + note.by + ", " : "" ) + when
			},
			noteInput: function()
			{
				// Save a moment after typing stops, and on leaving the box.
				clearTimeout( this.noteTimer )
				this.noteKey = this.selected.relative
				this.noteStatus = "Not saved yet…"
				this.noteTimer = setTimeout( () => this.flushNote(), 800 )
			},
			toggleKeep: function()
			{
				if ( !this.notesWritable || !this.selected ) return

				this.noteKeep = !this.noteKeep
				this.noteKey = this.selected.relative
				this.flushNote()
			},
			flushNote: function()
			{
				clearTimeout( this.noteTimer )
				this.noteTimer = null

				var key = this.noteKey

				if ( !key ) return

				this.noteKey = null

				var note = { text: this.noteText, keep: this.noteKeep }

				this.noteStatus = "Saving…"
				handlers.saveNote( key, note,
					saved =>
					{
						if ( saved ) this.$set( this.notes, key, saved )
						else this.$delete( this.notes, key )

						if ( this.selected && this.selected.relative === key ) this.noteStatus = saved ? this.noteSummary( saved ) : ""
					},
					message =>
					{
						if ( this.selected && this.selected.relative === key ) this.noteStatus = "Couldn't save: " + message
					} )
			},
			openFolder: function( folder )
			{
				handlers.openFolder( folder, a => this.args = a )
			},
			toggleFolders: function()
			{
				this.showFolders = !this.showFolders

				// Nothing open yet: start browsing at the top of the disk.
				if ( this.showFolders && !this.args.folder ) this.openFolder( "/" )
			},
			chooseFolder: function()
			{
				handlers.chooseFolder( a =>
				{
					this.args = a
					this.showFolders = false
				} )
			},
			copyPath: function()
			{
				handlers.copyPath( this.args, this.selected.relative )
				this.copied = true
				setTimeout( () => this.copied = false, 1500 )
			},
			showInFolder: function()
			{
				handlers.showInFolder( this.args, this.selected.relative )
			},
			deleteEvent: function()
			{
				var e = this.selected

				if ( !e || !confirm( `Delete ${e.relative} and every file in it? This cannot be undone.` ) ) return

				this.controls.playing = false
				this.selected = null
				handlers.deleteFolder( e.relative, () => handlers.reopen( a => this.args = a ) )
			},
			openBrowser: function()
			{
				handlers.openBrowser()
			},
			timeText: function( date )
			{
				return new Date( date ).toLocaleTimeString( [], { hour: "2-digit", minute: "2-digit" } )
			},
			dateText: function( date )
			{
				return new Date( date ).toLocaleDateString( [], { weekday: "short", day: "numeric", month: "short", year: "numeric" } )
			},
			dayLabel: function( date )
			{
				var d = new Date( date )
				var today = new Date()
				var yesterday = new Date()

				yesterday.setDate( today.getDate() - 1 )

				if ( d.toDateString() === today.toDateString() ) return "Today"
				if ( d.toDateString() === yesterday.toDateString() ) return "Yesterday"

				return this.dateText( d )
			},
			toggleCategory: function( name )
			{
				var i = this.hidden.indexOf( name )

				if ( i < 0 ) this.hidden.push( name )
				else this.hidden.splice( i, 1 )
			},
			selectFromHash: function()
			{
				var relative = decodeURIComponent( location.hash.slice( 1 ) )

				this.selected = this.events.find( e => e.relative === relative ) || null

				if ( this.selected && !this.fromList ) this.$nextTick( () =>
				{
					var item = this.$refs.list && this.$refs.list.querySelector( ".event.active" )

					if ( item ) item.scrollIntoView( { block: "center" } )
				} )
			},
			goBack: function()
			{
				// Back to the list. Use the browser's history when we came from it,
				// so the phone's own Back button and this one agree.
				if ( this.fromList && location.hash )
				{
					this.fromList = false
					history.back()
				}
				else
				{
					history.replaceState( null, "", location.pathname + location.search )
					this.selectFromHash()
				}
			},
			setUpPicker: function()
			{
				if ( this.picker ) this.picker.destroy()

				var dates = Array.from( new Set( this.events.map( e => new Date( e.date ).toDateString() ) ) )

				this.picker = flatpickr( this.$refs.jump,
				{
					enable: dates.map( d => new Date( d ) ),
					disableMobile: true,
					onChange: picked => this.jumpToDay( picked[ 0 ] )
				} )
			},
			jumpToDay: function( date )
			{
				if ( !date ) return

				var key = date.toDateString()
				var event = this.events.find( e => new Date( e.date ).toDateString() === key )

				// A hidden type would hide the day; show everything again.
				if ( event && this.hidden.includes( this.categoryOf( event ) ) ) this.hidden = []

				this.$nextTick( () =>
				{
					var section = this.$refs.list.querySelector( `[data-day="${key}"]` )

					if ( section ) section.scrollIntoView( { block: "start" } )
				} )
			},
			key: function( e )
			{
				if ( !this.selected || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test( e.target.tagName ) ) return

				if ( e.key === " " )
				{
					e.preventDefault()
					this.controls.playing = !this.controls.playing
				}
				else if ( e.key === "Escape" ) this.focus = null
			}
		}
	} )
} )();
