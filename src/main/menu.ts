import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export function installMenu(getWindow: () => BrowserWindow | null): void {
  const send = (command: MenuCommand): void => {
    const focused = BrowserWindow.getFocusedWindow()
    const win = focused ?? getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('menu:command', command)
  }

  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(command)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Project',
      submenu: [
        item('New project', 'project:new', 'CmdOrCtrl+N'),
        item('Open project', 'project:open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Save', 'file:save', 'CmdOrCtrl+S'),
        item('Save all', 'file:save-all', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Close tab', 'file:close', 'CmdOrCtrl+W'),
        item('Close all tabs', 'file:close-all'),
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Host',
      submenu: [
        item('Add host', 'host:add'),
        item('Edit host', 'host:edit'),
        item('Duplicate host', 'host:duplicate'),
        item('Remove host', 'host:remove'),
        { type: 'separator' },
        item('Connect', 'host:connect'),
        item('Disconnect', 'host:disconnect'),
        item('Open file', 'file:open'),
        item('Remove file', 'file:remove')
      ]
    },
    {
      label: 'Settings',
      submenu: [item('Settings…', 'app:settings'), item('Check for updates', 'app:check-updates')]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
