( function ( root, factory )
{
	if ( typeof define === 'function' && define.amd ) define( [], factory );
	else if ( typeof exports === 'object' ) module.exports = factory();
	else root.helpers = factory();
}( typeof self !== 'undefined' ? self : this, function ()
{
	const folderRegex = /(?<y>\d+)-(?<m>\d+)-(?<d>\d+)_(?<h>\d+)-(?<mm>\d+)(?:-(?<s>\d+))?$/g;
	const clipRegex = /(?<y>\d+)-(?<m>\d+)-(?<d>\d+)_(?<h>\d+)-(?<mm>\d+)(?:-(?<s>\d+))?-(?<c>.*).mp4$/g;

	function matchRegex( regex, value )
	{
		var result = regex.exec( value )

		regex.lastIndex = 0

		return result;
	}

	var matchFolder = ( folder ) => matchRegex( folderRegex, folder )
	var matchClip = ( file ) => matchRegex( clipRegex, file )

	function extractDate( match )
	{
		var year = Number( match.groups[ "y" ] )
		var month = Number( match.groups[ "m" ] ) - 1
		var day = Number( match.groups[ "d" ] )
		var hour = Number( match.groups[ "h" ] )
		var minute = Number( match.groups[ "mm" ] )
		var second = match.groups[ "s" ] ? Number( match.groups[ "s" ] ) : 0

		return new Date( year, month, day, hour, minute, second )
	}

	function groupBy( list, keyGetter )
	{
		const map = new Map();

		list.forEach( ( item ) =>
		{
			const key = keyGetter( item );
			const collection = map.get( key );

			if ( !collection ) map.set( key, [ item ] );
			else collection.push(item);
		});

		return map;
	}

	function groupFiles( folder, files, getVideoPath )
	{
		var fileInfos = []

		if ( files )
		{
			for ( var file of files )
			{
				var match = matchClip( file )

				if ( match && match.length > 0 )
				{
					var date = extractDate( match )
					var camera = match.groups[ "c" ]
					var filePath = folder + "/" + file // path.join( folder, file )

					fileInfos.push(
						{
							date: date,
							camera: camera,
							file: getVideoPath( filePath ),
							filePath: filePath,
							fileName: file
						} )
				}
			}

			fileInfos.sort( ( f1, f2 ) => f1.date.getTime() - f2.date.getTime() )
		}

		return groupBy( fileInfos, f => f.date.toString() )
	}

	// Find the events under a folder: event folders in SavedClips, SentryClips,
	// TrackMode and the like, and loose RecentClips. Used by the server (on
	// disk) and in the browser (on a folder the visitor picked), so file access
	// comes in as `fsx`:
	//   list( p )       names in a folder (may throw)
	//   isDir( p )      true for a folder
	//   exists( p )     true if the file is there
	//   readEvent( p )  parsed event.json of a folder, or null
	//   join( a, b ), relative( from, to )   path handling
	function findEvents( folder, fsx )
	{
		var specialFolders = [ "TeslaCam", "SavedClips", "RecentClips", "SentryClips", "TeslaSentry", "TrackMode" ]
		var categoryNames = { SavedClips: "Saved", RecentClips: "Recent", SentryClips: "Sentry", TeslaSentry: "Sentry", TrackMode: "Track" }
		var folderInfos = []

		function addSubfolders( baseFolder, category )
		{
			try
			{
				for ( var subfolder of fsx.list( baseFolder ) )
				{
					if ( specialFolders.includes( subfolder ) )
					{
						addSubfolders( fsx.join( baseFolder, subfolder ), categoryNames[ subfolder ] || category )
						continue
					}

					var match = matchFolder( subfolder )

					if ( match && match.length > 0 )
					{
						var folderPath = fsx.join( baseFolder, subfolder )

						folderInfos.push(
							{
								date: extractDate( match ),
								path: folderPath,
								relative: fsx.relative( folder, folderPath ),
								recent: false,
								event: fsx.readEvent( folderPath ),
								category: category,
								thumb: fsx.exists( fsx.join( folderPath, "thumb.png" ) )
							} )
						continue
					}

					var clipMatch = matchClip( subfolder )

					if ( clipMatch && clipMatch.length > 0 )
					{
						var date = extractDate( clipMatch )
						var existing = folderInfos.find( i => i.path == baseFolder )

						if ( existing )
						{
							if ( date > existing.date ) existing.date = date
						}
						else
						{
							folderInfos.push(
								{
									date: date,
									path: baseFolder,
									relative: fsx.relative( folder, baseFolder ),
									recent: true,
									event: fsx.readEvent( baseFolder ),
									category: category
								} )
						}
					}
					else if ( /^\d{4}-\d{2}-\d{2}$/.test( subfolder ) )
					{
						// RecentClips sometimes nests clips in a date folder
						// (RecentClips/2023-12-04/2023-12-04_12-23-59-front.mp4).
						// Only those date folders are walked, not every directory on the drive.
						var datedPath = fsx.join( baseFolder, subfolder )

						if ( fsx.isDir( datedPath ) ) addSubfolders( datedPath, category )
					}
				}
			}
			catch ( e )
			{
				console.error( e && e.message ? e.message : e )
			}
		}

		addSubfolders( folder, null )

		return folderInfos
	}

	function isInViewport( elem )
	{
		var bounding = elem.getBoundingClientRect()

		return (
			bounding.top >= 0 &&
			bounding.left >= 0 &&
			bounding.bottom <= ( window.innerHeight || document.documentElement.clientHeight ) &&
			bounding.right <= ( window.innerWidth || document.documentElement.clientWidth )
		)
	}

	return {
		matchFolder: matchFolder,
		matchClip: matchClip,
		extractDate: extractDate,
		groupBy: groupBy,
		groupFiles: groupFiles,
		findEvents: findEvents,
		isInViewport: isInViewport
	}
} ) );
