const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('path')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('littlelingo')

  let mainWindow
  let appServer
  let appPort
  let quitting = false

  const createWindow = async () => {
    mainWindow = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 360,
      minHeight: 520,
      show: false,
      backgroundColor: '#fcfaf7',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url).catch((error) => {
          console.error('Could not open external link:', error.message)
        })
      }
      return { action: 'deny' }
    })

    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== `http://127.0.0.1:${appPort}`) {
        event.preventDefault()
        if (url.startsWith('https://') || url.startsWith('http://')) {
          shell.openExternal(url).catch((error) => {
            console.error('Could not open external link:', error.message)
          })
        }
      }
    })

    mainWindow.once('ready-to-show', () => mainWindow.show())
    try {
      await mainWindow.loadURL(`http://127.0.0.1:${appPort}`)
    } catch (error) {
      console.error('Could not load littlelingo:', error.message)
      dialog.showErrorBox('littlelingo could not start', 'The local notebook service could not be opened. Close and reopen the app, then try again.')
      app.quit()
    }

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  const startServer = async () => {
    process.env.HOST = '127.0.0.1'
    process.env.PORT = '0'
    const serverModule = require(path.join(__dirname, '..', 'server', 'index.js'))
    appServer = serverModule
    appPort = await serverModule.started
  }

  app.whenReady().then(async () => {
    try {
      await startServer()
      await createWindow()
    } catch (error) {
      console.error('Failed to start the local notebook service:', error.message)
      dialog.showErrorBox('littlelingo could not start', 'The local notebook service failed to start. Restart the app. If the problem continues, reinstall littlelingo.')
      app.quit()
    }
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('before-quit', (event) => {
    if (!appServer || quitting) return
    event.preventDefault()
    quitting = true
    appServer.stop()
      .catch((error) => console.error('Could not stop the local notebook service cleanly:', error.message))
      .finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && appPort) createWindow()
  })
}
