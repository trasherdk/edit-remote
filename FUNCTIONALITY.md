# edit-remote — functionality sketch

A desktop editor in the spirit of VS Code, with one difference that drives the rest of the design: **each open buffer belongs to a host**, and that host is reached over FTP, FTPS, or SFTP. There is no single “remote workspace.” The same path can be open on two machines at once.

The side panel is one named project: hosts, and under each host a tree of the files remembered from it. Adding or removing a host or a file writes that project. A normal tab shows one file by its short name. Compare is one tab that shows two files, source beside destination, with the differing lines colored.

This note proposes a first cut of behavior, then lists decisions worth settling before implementation. Recommendations are defaults to react to, not locked choices.

## Working model

- A **project** is a named file. It is the session: the hosts and the remote paths remembered under them. The side panel is the open project.
- A **host** is a connection profile in that project (protocol, address, credentials, optional initial directory).
- A **buffer** is one remembered file loaded into the editor. It remembers which host it came from and the remote path.
- Under each host, remembered paths form a directory tree. It is not a listing of the whole remote disk. A file can sit in the tree without a tab.
- **Open** is a dialog on a host that browses that host’s remote tree. Picking a file remembers it in the project, writes the project file, downloads it, and opens a tab.
- **Saving** uploads that buffer back to the same path. Editing happens locally in memory after the load.
- **Compare** is one tab bound to two buffers. The first is the source, the second is the destination. The coloring of lines is the diff.
- Many hosts may be connected at once. One connection (or a small pool) per host is shared by every buffer on that host.
- Disconnecting a host does not throw away unsaved edits. Those buffers stay listed until closed. Saving them requires the host to be connected again.

What this is not: VS Code Remote SSH (one machine, a full workspace, extensions running remotely), and not a file-transfer client with a preview pane. File management (rename, delete, upload a local file) is secondary to editing buffers you already chose to open.

## Suggested v1

Enough to open, edit, and safely save text files across several hosts, and to compare two of those files. Anything past that is called out under [Later](#later) or as a concern.

### Hosts

- Add, edit, duplicate, and remove a host profile. These actions, plus connect, disconnect, open, and close-all, live on an icon toolbar above the side panel. Commands that change the buffer (save, and later undo, find, and the rest) live on an icon toolbar above the editor. The same commands are in the menu. They are not buttons on each tree row. Each toolbar is one row of icons, each with a tooltip and a shortcut where one exists, in the style of SecureCRT’s button bar. It is not a row of labeled text buttons.
- Fields: display name, protocol (`ftp`, `ftps`, `sftp`), hostname, port, username, authentication, optional default remote directory.
- Authentication: an SSH private key file, with an optional passphrase. That is the first path, because there is no available SSH server that accepts a password. Password login stays in the product for later. FTPS is later too. The minimal test is SFTP only.
- Connect and disconnect per host. Show a clear state: disconnected, connecting, connected, failed (with the last error).
- Hosts are not part of a project. They live in the settings folder and are shared by every project. Adding, editing, or removing one writes that config. A new host can be filled from an entry in `~/.ssh/config`: the alias, host name, user, port, and identity file.

### Opening files

- **Open** is invoked on a host and opens a dialog that browses that host’s remote tree. The dialog does not become the side panel.
- The listing starts at the host’s default directory. Folders expand as they are opened. A breadcrumb or “up” control moves toward the root.
- Choosing a file remembers it on that host, writes the project, downloads it, closes the dialog, and opens a tab. Choosing a path already in the project focuses it, loading a tab if it does not have one.
- Under the host, the side panel builds a tree from remembered paths only. `/x/y/z.ext` and `/x/y/w.ext` share the `x` and `y` nodes. A file with no sibling still shows its parent folders, so the path is the tree.
- The tree row and the tab label are the short file name, plus a dirty marker when a buffer is loaded. Hovering either one shows the host alias and the path, `alias:/x/y/z.ext`. The status bar shows that same identity for the active file.
- Activate a tree row to load or focus that file’s tab. Close a tab to unload the buffer; the file stays in the tree for later. Remove a row to drop it from the project, which writes the file (confirm if the buffer is dirty). Remove a host to drop it from settings. Files remembered for it in the open project are removed too.
- Opening a project lists every remembered file without downloading them all. A tab loads on activation. The last open project is what comes back on launch.

### Project

The side panel is saved as a named project file, in the same sense as a document: the user names it, picks where it lives, and can open it later.

- **New project** is the system save dialog. The file name, without `.erproj`, is the project name. A new folder is created from that dialog’s own New folder control.
- The file is written immediately when a remembered file is added or removed. Typing in a buffer does not write it. Host changes do not write it.
- What it stores: project name, and the remote path of each remembered file together with the id of the host it belongs to. Compare tabs are pairs of those paths. Connection fields, passwords, and key passphrases are not in the file.
- One project is open. Opening another replaces the side panel, after a confirm when any buffer is dirty.
- A remembered path that no longer exists on the server stays in the tree. Loading it shows the error. The user removes the row when they want it gone.

### Editor

- Tabbed. One tab per loaded buffer, labeled with the short file name. Compare adds a different kind of tab, described below. The tree is the remembered set; tabs are the files loaded from it.
- Text editing comparable to a normal code editor: undo/redo, cut/copy/paste, find, replace, go to line, word wrap, indentation, syntax highlighting from the file extension, visible whitespace and line endings in the status bar.
- Dirty state is per buffer, shown on the tab and the side-panel row. **Save** writes the active buffer. **Save all** writes every dirty buffer, per host.
- Status bar: host name, protocol, full remote path, connection state, cursor position, encoding, line ending, and save/load errors.
- Editing stays allowed while the host is disconnected. Saving does not, until reconnect. The buffer is read-only when the server reports the file is not writable.

### Compare

The useful case is the same remote path on two hosts: the file you trust beside the file you would change. Any two open text buffers can be compared; matching paths are the pair we offer first, not a requirement.

- Compare is **one tab with two panes**, implemented as a CodeMirror `MergeView`. The first pane is the source. The second is the destination. There is no third diff pane; the line colors are the diff.
- In that view, editor **B is the source** and editor **A is the destination**, with orientation `b-a` so source stays on the left. CodeMirror already paints B’s changed lines green and A’s changed lines red, and it inserts spacers so unchanged lines share a row. We keep that and only strengthen the colors in CSS.
- The tab label is the two short names. Hovering a pane shows that side’s `alias:/x/y/z.ext`.
- Both panes are the real buffers, including unsaved edits. Typing in a pane updates that buffer and the chunks. Saving still writes each buffer only to its own host.
- A chunk control copies from the source onto the destination (`revertControls: "b-to-a"`). That edits the destination buffer and marks it dirty. It does not upload. The button should say that it applies the source chunk, not that it reverts.

```text
source              destination
keep                keep
only here           ·
·                   only here
new wording         old wording
```

The first `only here` is green. The second is red. `new wording` is green and `old wording` is red. `keep` has no color. Read that way, green is what the destination lacks, and red is what the destination has that the source does not. Making the destination match the source means taking the green lines and dropping the red ones. That is the pull-request reading, with the source as the proposed file and the destination as the file being changed.

- Closing the compare tab drops the view, not the two buffers. They stay in the tree and in their own tabs.

### Load and save

- Load and save transfer the whole file. Progress is shown for slow transfers. A transfer can be cancelled.
- Before save, compare remote size and modification time (SFTP attributes, or FTP `MDTM`/`SIZE` when the server supports them) with the values captured at load. If they differ, ask before overwriting.
- Write to a temporary name in the same directory, then rename over the target when the server allows it. If rename-over is not possible, overwrite in place and say so in the error or status text.
- On failure, the buffer stays dirty and the tab and side-panel row show the error. A partial remote write should be called out in that error when we can detect it.
- Text files only in v1. If the payload looks binary, refuse to open it as text and explain why. Compare is text against text.

### Connection behavior

- FTP defaults to passive mode.
- SFTP checks the server host key. Unknown keys require an explicit accept; accepted keys are remembered.
- Idle connections may drop. The next load, save, or directory listing reconnects, or the user reconnects from the host row.
- Credentials are not written into a plain settings file if the OS credential store is available.

### Preferred stack

Same shape as `sieve-editor`: a desktop app, the window in Svelte, the network elsewhere.

- **Electron**, via electron-vite. FTP and SFTP need long-lived sockets, host-key checks, and the OS credential store. The main process owns connections, directory listings, transfers, and the project file. The renderer never gets `net` or `tls`. `contextIsolation` on, `nodeIntegration` off, a narrow preload bridge.
- **Svelte 5 + TypeScript + Tailwind 4** in the renderer. Not SvelteKit: there is no server, no routes, and no form actions.
- **CodeMirror 6** for each buffer: syntax highlighting, undo, find, and the tab contents. One editor instance per loaded file.
- **Compare** starts from `@codemirror/merge`’s `MergeView`: source is editor B, destination is editor A, orientation `b-a`. Changed lines on B are already green and on A already red; spacers already align the rows. CSS makes those colors obvious. Chunk buttons copy source onto destination only. A hand-rolled diff is what we build if this view cannot say what we mean.
- **SFTP** through `ssh2`: a private key file parsed in process, optional passphrase, `hostVerifier` for the known-host prompt. Password login, and **FTP / explicit FTPS** through `basic-ftp`, come after that. One session per host, queued in main.
- **Project file** is JSON at the path the user chose, written by main on host or file add, edit, or remove. Secrets are not in it.
- **Settings folder** is chosen the first time the app needs one. It holds the host list, the last project, which files were open, window bounds, and the passphrase file. **Electron `safeStorage`** encrypts passphrases before they are written there (DPAPI on Windows). A copied project does not include hosts or secrets. The app only remembers that folder path, so the next start can find it.
- Dirty buffer text, if we keep it across a restart, is a cache in that settings folder, not a field in the project file.

### What has to be installed

The running app does not look for **git**, **OpenSSH**, or an **openssl** program on `PATH`. None of those is a requirement.

- **Git** is unused. It stays in the later list.
- **OpenSSH** (`ssh`, `sftp`, `ssh-keygen`) is unused. `ssh2` is a JavaScript SSH client inside Electron. It speaks SFTP itself and parses PEM and OpenSSH private keys in process. It is developed against OpenSSH servers; the server is remote, the client binary is not local.
- **OpenSSL** the program is unused. FTP-with-TLS and key math go through the OpenSSL that Electron already links into Node. `basic-ftp` uses `tls`. There is nothing to shell out to.

Startup check that does matter: `safeStorage.isEncryptionAvailable()`. On Windows that is DPAPI and should be present. If it is not, the app refuses to save a password or key passphrase rather than writing it into the project file. An ssh-agent or Pageant is optional later, for people who already have one; its absence is not a failed check.

To build the app, the machine needs Node and pnpm. The packaged app does not. The desktop OS is whatever that Electron version still supports; Windows 10 or later is the floor for current Electron.

Tauri plus Rust is the lighter runtime, and it would mean rewriting the protocols and leaving the Svelte/Electron app you already build. Monaco is the VS Code editor and a large bundle; CodeMirror is already the editor in `sieve-editor`. A VS Code extension fights the model, because VS Code Remote is one workspace on one host.

## Minimal test

One loop, against a real SFTP host that accepts a key:

- Create a named project.
- Add one SFTP host: display name, hostname, port, username, path to a private key, optional key passphrase. No password field in this test.
- On first connect, show the server host key and remember it only if it is accepted. Store the passphrase with `safeStorage`, not in the project file.
- Browse from the host’s default directory, open one text file, edit it, save it back to the same path.
- Close the tab. The file stays in the tree. Reopen the project and the file is still listed. Activating it downloads again.

Not in this test: a second host, compare, FTP, FTPS, password login, conflict checks, temp-file rename, and a crash cache of unsaved text.

## Later

Not required to prove the product, and easy to grow once buffers-on-hosts feels right:

- Command palette and remote search (in a folder, or across open buffers).
- Create file, create folder, rename, delete.
- Download a copy to local disk, or upload a local file onto a host.
- Encoding picker, line-ending conversion, and a larger-file mode.
- Themes, font, tab size.
- Language servers, formatters, git, terminal, tasks, extensions.

## Concerns to clarify

Each item is a product choice. The **lean** is a reasonable default if we want to start.

Settled for now: the side panel is one named project, written when a host or a remembered file is added or removed; opening is a per-host dialog that browses the remote tree; closing a tab unloads a file and leaves it in the tree; the editor is tabbed; host actions live on an icon toolbar and in the menu; a tab shows the short file name and `alias:/x/y/z.ext` on hover; compare is one tab with source then destination, source-only lines green, destination-only lines red.

### Side panel and tabs

1. **Which host the toolbar acts on.** Host and session icons sit above the side panel. Editing icons sit above the editor. Every one of those commands is also a menu item. The host toolbar needs a selected host. Selecting a file in the tree selects its host. *Lean: the toolbar follows the tree selection. With nothing selected, only Add host is available.*
2. **Deep trees with one file.** `/var/www/site/public/index.php` is four folders for one leaf. *Lean: show every folder. Collapsing a chain of single-child folders can wait.*
3. **Compare tab versus the two file tabs.** Clicking a file in the tree focuses its own tab. The compare tab is opened on purpose and is not what the tree selects. *Lean: keep it that way, so the tree always means “this file,” and compare is a separate tab over the same two buffers.*

### How much “like VS Code”

- **4. Which editor features are actually in v1?** Syntax highlighting and find/replace are assumed. Multi-cursor, minimap, breadcrumbs, and multiple selections come along with an embeddable editor and should not set the schedule. *Lean: use a full editor component and accept its built-in editing; do not build VS Code features around it yet.*
- **5. IntelliSense and formatters.** They need language servers, and those servers need a local copy or a remote execution story. That is a different product. *Lean: highlighting only, no LSP.*
- **6. Local files.** Mixing a local disk host with FTP hosts is natural in the same panel (a built-in “This computer” host) and also blurs the scope. *Lean: remote hosts only until the remote save path is solid.*

### The open dialog

- **7. What the listing contains.** Name and file-or-folder is enough to open a file. Size, mtime, and permissions help and cost more parsing, especially on FTP. *Lean: name and kind. Folders first, then name.*
- **8. Hidden files.** Dotfiles matter on servers and clutter the list. *Lean: show them. A toggle can wait.*
- **9. Remembering the folder.** Starting at the host default every time fights browsing a deep tree. *Lean: remember the last folder per host in the project (see project-file concerns). The host’s default directory is only the start before any listing.*
- **10. Several files at once.** Multi-select matches “open a few files from this folder.” It complicates the dialog. *Lean: one file per confirmation in v1.*
- **11. A path field inside the dialog.** Browsing is the way in. Pasting a known path is still faster when you have it. *Lean: a path field that lists that directory, or opens the file if the path is a file.*
- **12. Host is down when Open is clicked.** *Lean: the dialog connects, shows progress, and surfaces the connection error in the dialog.*
- **13. Slow or failed listings.** One stalled `LIST` should not freeze the app. *Lean: cancel, retry, and an inline error for that folder. The rest of the tree stays as it was.*
- **14. Dirty text is not the project.** The project remembers paths, not unsaved editing. A crash otherwise loses typing. *Lean: keep dirty buffer text in a local cache next to the session, marked unsaved. Opening the project still does not download every file; a cached dirty buffer reloads from the cache and stays dirty. Confirm before a refetch replaces it.*

### Compare behavior

- **15. Who is source and who is destination.** The first pane is source, the second is destination, and that choice sets the colors. The picker has to make the order explicit. *Lean: when the same path is open on another host, offer those buffers as the other side, and ask which of the two is the source. Swapping panes swaps the colors.*
- **16. Line color and the span inside it.** `MergeView` tints the whole changed line and underlines the changed characters. *Lean: keep both. The line color is the spec; the underline is free.*
- **17. Does the diff include unsaved edits?** A review of “what is on the servers” and a preview of “what save will do” disagree once either buffer is dirty. *Lean: color the current buffer text, and mark a pane when it is dirty so the colors are not read as a clean remote-to-remote comparison.*
- **18. Applying a change.** `MergeView` can copy one chunk from source (B) onto destination (A). That can overwrite production as soon as someone saves. *Lean: show that control, relabeled as apply-from-source. It only edits the destination buffer. Upload happens on Save, with the normal conflict check.*
- **19. Lines that moved, and long files.** `MergeView` treats a move as a removal plus an insertion, so the same text is red on the destination and green on the source. Its diff also stops scanning after 500 lines of change unless we raise `diffConfig.scanLimit`, and then a chunk can be marked imprecise. *Lean: keep the stock alignment, including moves as red plus green. Raise the scan limit enough for the files we allow, and say so on a chunk that was not fully compared.*
- **20. Newlines and charset.** A file that differs only by CRLF versus LF will light up every line. *Lean: compare the text as loaded, and do not normalize. The status bar already shows line endings, so the cause is visible.*
- **21. One side reloads or fails to load.** Compare of a stale buffer is misleading. *Lean: either pane can reload on its own. If a reload is refused or fails, compare stays on the text still in the buffer and says so.*

### Safety of save

- **22. Conflict check.** Size plus mtime catches most outside edits and misses same-second writes. Hashing the remote file means an extra download. *Lean: size + mtime when the server provides them; if it provides neither, warn once per save that overwrite cannot be checked.*
- **23. Atomic replace.** Temp-file-and-rename can change ownership or mode, and some FTP servers cannot rename over an existing file. *Lean: try rename-over; fall back to overwrite; preserve mode on SFTP when we can.*
- **24. Line endings and encoding.** Saving with the wrong newline or charset corrupts the remote file. *Lean: keep the encoding and newlines detected at load; show both in the status bar; do not convert on save. Detection failures become an explicit choice before the first save.*
- **25. Large files.** A multi-hundred-megabyte log will freeze a text editor, and a diff of two of them worse. *Lean: refuse above a fixed size (for example 5 MB) with a message, rather than a special large-file mode.*
- **26. Binary.** Images and archives should not be decoded as text. *Lean: detect and refuse. No hex editor in v1. Compare refuses if either side is binary.*

### Connections and credentials

- **27. Where secrets live.** OS keychain, an encrypted local file, or a config the user can read. FTP passwords and key passphrases are the sensitive part; hostnames are not. *Lean: OS credential store, profiles without secrets in a local config file.*
- **28. Host keys.** Strict checking blocks first connect; accept-anything is unsafe. *Lean: prompt on first sight, remember the key, prompt again if it changes.*
- **29. FTPS scope.** Explicit FTPS (AUTH TLS) is the common case. Implicit FTPS (port 990) and “TLS if available” are extra branches. *Lean: explicit FTPS only in v1, plus plain FTP and SFTP.*
- **30. One session or many.** A single SFTP channel per host is simpler and matches “files share a host.” A browse dialog and a save at the same time want two operations in flight. *Lean: one session per host; listings and transfers on that host queue.*
- **31. Server quirks.** Some FTP servers use a non-UTF-8 filename encoding, reject `MLSD`, or stall in passive mode. Directory browsing hits this immediately. *Lean: assume UTF-8 and passive FTP; keep a per-host compatibility note in the profile only after a real server needs it.*

### Failure and offline editing

- **32. Edit while disconnected.** Allowed, because the buffer is already local. The risk is forgetting the save never happened. *Lean: allow editing; dirty tabs stay visible; Save on a dead host offers Reconnect and save. Compare still works from the local text.*
- **33. Dropped connection mid-save.** We may not know whether the server kept the old file, the new file, or a partial one. *Lean: leave the buffer dirty, surface the error, and require a successful reload or a confirmed overwrite before treating it as saved.*
- **34. Reload.** Needed after an outside change or a failed save. *Lean: Reload from host, with a confirm when the buffer is dirty.*

### Identity of a file

- **35. Same path, two profiles.** Two host entries can point at the same machine. They stay different hosts, including as the two sides of a compare. *Lean: do not try to merge them.*
- **36. Symlinks.** Opening a symlink may show the link path while the server writes through to another inode, which confuses the conflict check. The browse dialog is where this shows up. *Lean: show the link as the server lists it; open the path the user picked; do not resolve and rewrite the path in v1.*
- **37. Rename on the server while open.** We will not notice until save or reload. *Lean: accept that; conflict detection is the backstop.*

### Scope of file operations

- **38. Creating a new remote file.** The dialog browses existing files, so “new file” is a separate action (a name in the current folder). *Lean: out of v1, unless opening a typed path that does not exist yet asks to create it on first save.*
- **39. Delete, rename, chmod, mkdir.** Useful from the same dialog and also a class of destructive mistakes. *Lean: out of v1. The dialog only opens.*
- **40. Watching the remote file.** Polling mtime is noisy on FTP and costs a round trip. *Lean: no live watch; check on save only. Compare does not poll.*

### Project file

- **44. When the name is chosen.** Saving on every add or remove needs a path to write to. *Settled: New project is a save dialog. The file name is the project name. There is no untitled project.*
- **45. Editing a host.** The request was to save on add or remove. Changing a port, user, or default directory is the same file and is easy to lose if it waits for a later remove. *Lean: host-field edits write the project immediately too. Buffer edits do not.*
- **46. Compare tabs in the file.** A compare tab is part of the session the user will want back. *Lean: store each compare as the two identities (source path on its host, destination path on its host). Restoring opens the tab and loads both sides.*
- **47. Secrets and a copied project.** The file is meant to be kept and reopened, and it may be copied to another machine. *Lean: the project holds hostnames, users, ports, protocols, key paths, and remote paths. Secret values stay in the OS store. A copied project connects only after the secrets are entered again.*
- **48. Last browse folder.** Useful on the next Open, and it is session state rather than a remembered file. *Lean: store the last listing directory per host in the project.*

### Product shell

- **41. Single window.** Multiple windows multiply which host is connected where, and which pair is being compared. *Lean: one window, one compare at a time.*
- **42. Logging.** Connection and listing failures are painful to diagnose without a protocol log. *Lean: a per-host log the user can open, with passwords redacted.*
- **43. Stack.** Preferred stack is recorded above: Electron, Svelte 5, CodeMirror 6, `ssh2`, `basic-ftp`, JSON project file, `safeStorage` for secrets. No git, OpenSSH, or openssl binary. Still worth a check once a host connects for real: `ssh2` host-key prompt, and `basic-ftp` explicit FTPS against a server that is not pure SFTP.
