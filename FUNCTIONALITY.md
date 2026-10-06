# edit-remote

A desktop editor where each open file belongs to a host and is loaded and saved over SFTP. There is no single remote workspace. The same path can be open on two hosts at once.

## What it does

A **project** is a named `.erproj` file. New project uses the system save dialog. The file name, without `.erproj`, is the project name. The project stores the remote path of each remembered file and the id of the host it belongs to. It is written when a remembered file is added or removed. Typing does not write it. One project is open. Opening or creating another asks first when a buffer is dirty. The last project, the open tabs, and which folders are collapsed come back on launch. Those open tabs are downloaded again, in the order they were opened, and each host session stays open.

A **host** lives in the settings folder and is shared by every project. Fields are display name, hostname, port, username, private key file, optional key passphrase, and an optional default directory. A new host can be filled from `~/.ssh/config`. Passphrases are encrypted with `safeStorage` and are not in the project file. Duplicate copies the profile, including the stored passphrase, under a new id. Remove drops the host from settings and drops its files from the open project. The last browse directory is stored on the host.

Connect and disconnect are per host. The state is disconnected, connecting, connected, or failed. One SFTP session per host is shared by every file on that host, with up to eight requests in flight. A session stays open after a transfer. It closes on disconnect, host removal, a dropped server, or quit. The next load, save, or listing opens a session again if there is none. Unknown or changed host keys require an explicit accept, and the accepted fingerprint is stored. Editing stays allowed while the host is disconnected. Saving reconnects.

**Open** is a dialog on a host. It starts at the last directory, then the host default. The side panel is a tree of remembered paths only, not the remote disk. A file can sit in the tree without a tab. A click selects that file, so the next command can remove it. If the file already has a tab, the click focuses it. A double-click loads it. Closing a tab unloads the buffer and leaves the file in the tree. Removing a dirty file asks first. A path that fails to load stays in the tree, and the row shows the error.

The editor is tabbed. A tab and a tree row use the short file name. Hover and the status bar use `alias:/path`. Tabs can be dragged. Each tab keeps its scroll position and cursor. Ctrl+Tab switches between the last two tabs. Alt+1 through Alt+9 pick a tab. The editor is CodeMirror: undo, find and replace, syntax highlighting from the extension, tab indent, and completion of words already in the buffer (Ctrl+Space). Files over 5 MB, files with a NUL byte, and files that are not UTF-8 are refused.

The host toolbar sits above the side panel. The editor toolbar sits above the editor. The same commands are in the Project and Host menus.

- Project: New project (Ctrl+N), Open project (Ctrl+O), Save (Ctrl+S), Save all (Ctrl+Shift+S), Close tab (Ctrl+W), Close all tabs.
- Host: Add, Edit, Duplicate, Remove, Connect, Disconnect, Open file, Remove file.

On the Hosts tab, host actions follow a selected host row. With no row selected they are off, even if a file tab is open. On the Files tab, selecting a file selects its host. Close all tabs asks once when any buffer is dirty, then unloads every tab and leaves the files in the tree.

**Save** writes the active buffer back to the same path. Save all writes every dirty buffer. Before writing, the save compares the remote size and modification time from `STAT` with the values taken after the file was read. `STAT` carries the same size and time as `ls -l`. If either differs, it asks before overwriting and shows only the value that changed. The bytes go to a temporary name in the same directory, then replace the target with the OpenSSH rename when the server allows it. Otherwise the save overwrites in place, says so in the status bar, and the buffer stays dirty if that write fails. The mode captured at load is applied again when the server accepts it. A failed save leaves the buffer dirty. The tab and the tree row show the error.

A file whose mode has no owner-write bit opens read-only. A missing mode is treated as writable. Line endings are kept as loaded and shown in the status bar as LF, CRLF, CR, or Mixed. Encoding in the status bar is UTF-8, which is the only encoding the editor accepts. The bar also shows the connection state, the cursor, and the app version (`dev` or `portable` when that is what is running).

A packaged build, installer or portable, keeps `config-location.json` next to the exe and the settings in a `config` folder there. `pnpm run dev` asks once and remembers the folder from the app-data pointer. A passphrase copied to another Windows user still cannot be decrypted. Settings, from the gear or the Settings menu, are stored in that folder. Updates follow stable releases, beta builds, or rc builds. Beta also includes rc builds. Rc includes stable releases and leaves beta builds out. Packaged builds check on startup, from Settings, from the Settings menu, and when the version in the status bar is clicked. A stable release of the same version is still newer than its beta or rc.

The app does not look for git, OpenSSH, or an openssl program. Startup checks `safeStorage.isEncryptionAvailable()` and refuses to store a passphrase when encryption is unavailable.

## Next

- **Compare.** One tab, two real buffers, CodeMirror `MergeView`. Source is editor B on the left, destination is editor A on the right, orientation `b-a`. Source-only lines stay green, destination-only lines stay red. The chunk control copies source onto destination (`revertControls: "b-to-a"`), marks the destination dirty, and does not upload until Save. Relabel that button so it does not say Revert. The tab label is the two short names. Closing the compare tab drops the view, not the buffers.
- **Reload** from the host, with a confirm when the buffer is dirty.
- **Transfer progress and cancel** for a slow load or save.
- **Dirty text across a restart.** A crash cache in the settings folder, not in the project file. Opening the project still does not download every remembered file. A cached dirty buffer reloads from the cache and stays dirty.
- Word wrap and visible whitespace.

## Later

- Password login, FTP, and explicit FTPS.
- Create, rename, delete, download a local copy, upload a local file.
- Encoding picker, line-ending conversion, and files over 5 MB.
- Themes, font, tab size, command palette, remote search.
- Language servers, formatters, git, terminal, tasks, extensions.

## Release

Ship from a clean `develop` that matches `origin/develop`. `master` is the release branch.

```bash
pnpm release
pnpm release:patch
pnpm release:minor
pnpm release:major
pnpm release:patch -- beta
pnpm release -- beta
pnpm release -- rc
```

`pnpm release:patch`, `release:minor`, and `release:major` move the version numbers. With `beta` or `rc`, that new version starts at `vX.Y.Z-beta.1` or `vX.Y.Z-rc.1`. Repeating `pnpm release -- beta` (or `rc`) on that same version increments the number (`beta.2`, `rc.2`). `pnpm release` with no channel then tags the stable `vX.Y.Z`. The script merges `develop` into `master`, fast-forwards `develop` to that commit, and pushes the tag. GitHub Actions publishes the GitHub Release with Windows (NSIS setup and portable) and Linux (AppImage and .deb) binaries, then writes notes from commits since the previous tag. Stable notes skip prerelease tags. `beta` and `rc` tags are GitHub prereleases. Settings chooses which of those the update check includes: beta includes rc and stable, and rc includes stable. Do not create that GitHub Release locally. On the stable choice, a packaged beta is offered the stable release when it exists.
