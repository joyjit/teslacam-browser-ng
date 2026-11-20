// Modules to control application life and create native browser window
const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require( "electron" )
const menu = require( "./menu" )
const services = require( "./services" )
const { autoUpdater } = require( "electron-updater" )
const settings = require( "electron-settings" )
const fs = require( "fs" )
const path = require( "path" )
const express = require( "express" )

autoUpdater.on( "error", error =>
{
	console.log( "Update check failed: " + ( error && error.message ? error.message : error ) )
} )

try
{
	autoUpdater.checkForUpdatesAndNotify()
}
catch ( error )
{
	console.log( "Update check skipped: " + error.message )
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow()
{
	// Create the browser window.
	mainWindow = new BrowserWindow(
	{
		width: 1000,
		height: 700,
		webPreferences:
		{
			preload: path.join( __dirname, "preload.js" ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	} )

	// The same page the server shows (web.html), talking to this process
	// through preload.js instead of HTTP.
	mainWindow.loadFile( "web.html" )

	// Open the DevTools.
	// mainWindow.webContents.openDevTools()

	// Emitted when the window is closed.
	mainWindow.on( "closed", function ()
	{
		// Dereference the window object, usually you would store windows
		// in an array if your app supports multi windows, this is the time
		// when you should delete the corresponding element.
		mainWindow = null
	} )

	initialize()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on( "ready", createWindow )

// Quit when all windows are closed.
app.on( "window-all-closed", function ()
{
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if ( process.platform !== 'darwin' ) app.quit()
} )

app.on( "activate", function ()
{
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( mainWindow === null ) createWindow()
} )

function initialize()
{
	const port = 8088

	services.setVersion( app.getVersion() )

	// The folder last opened, by the dialog or the page's folder list. Checked
	// before the page asks for it, so a drive that was unplugged since shows
	// "Choose a folder" instead of an error.
	var lastFolder = settings.get( "folder" ) || ( settings.get( "folders" ) || [] )[ 0 ]

	if ( lastFolder && fs.existsSync( lastFolder ) )
	{
		console.log( `Opening Last Folder (${lastFolder})` )
		services.setFolder( lastFolder )
	}
	else
	{
		if ( lastFolder ) console.log( `Last folder (${lastFolder}) doesn't exist anymore` )
		services.setFolder( "" )
	}

	function setFolder( args )
	{
		services.setFolder( args.folder )
		settings.set( "folder", args.folder )

		return args
	}

	services.initializeExpress( port )

	function open()
	{
		// showOpenDialog() has returned a Promise since Electron 6. The old call
		// handed that Promise to openFolders(), so choosing a drive did nothing.
		var folders = dialog.showOpenDialogSync( { properties: [ "openDirectory" ] } )

		if ( folders && folders.length > 0 )
		{
			settings.set( "folders", folders )
			settings.set( "folder", folders[ 0 ] )
		}

		return services.openFolders( folders )
	}

	// File > Open Folder... hands the result to the page.
	menu.initialize( () => mainWindow.webContents.send( "folderOpened", open() ) )

	function browse()
	{
		console.log( `Opening browser at http://localhost:${port}` )
		shell.openExternal( `http://localhost:${port}` )
	}

	ipcMain.on( "args", event => event.returnValue = services.args() )
	ipcMain.on( "openFolders", event => event.returnValue = open() )
	ipcMain.on( "reopenFolders", event => event.returnValue = services.reopenFolders() )
	ipcMain.on( "openFolder", ( event, folder ) => event.returnValue = setFolder( services.openFolder( folder ) ) )
	ipcMain.on( "getFiles", ( event, p ) => event.returnValue = services.getFiles( p, f => path.join( services.args().folder, f ) ) )
	ipcMain.on( "openBrowser", event => browse() )
	ipcMain.on( "deleteFiles", ( event, files ) => services.deleteFiles( files ) )
	ipcMain.on( "copyFilePaths", ( event, filePaths ) => clipboard.writeText( services.copyFilePaths( filePaths ) ) )
	ipcMain.on( "deleteFolder", ( event, folder ) => services.deleteFolder( folder ) )
	ipcMain.on( "copyPath", ( event, p ) => clipboard.writeText( services.copyPath( p ) ) )
	ipcMain.on( "openExternal", ( event, p ) => shell.showItemInFolder( p ) )
}
