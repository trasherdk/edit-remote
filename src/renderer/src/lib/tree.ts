export type FileTreeRow = {
  id: string
  name: string
  path: string
  kind: 'dir' | 'file'
  gutter: string
  collapsed: boolean
}

export type TreeNode = {
  name: string
  path: string
  kind: 'dir' | 'file'
  children: TreeNode[]
}

export function ancestorDirs(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean)
  const dirs: string[] = []
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc += `/${parts[i]}`
    dirs.push(acc)
  }
  return dirs
}

export function fileName(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? remotePath
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const full of paths) {
    const parts = full.split('/').filter(Boolean)
    let level = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      acc += `/${name}`
      const isFile = i === parts.length - 1
      let node = level.find((item) => item.name === name && item.kind === (isFile ? 'file' : 'dir'))
      if (!node) {
        node = { name, path: isFile ? full : acc, kind: isFile ? 'file' : 'dir', children: [] }
        level.push(node)
      }
      level = node.children
    }
  }
  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) sort(node.children)
  }
  sort(root)
  return root
}

/** Gutter rows: ├ or └, then children, with no blank line between them. Collapsed directories omit their children. */
export function flattenFileTree(nodes: TreeNode[], collapsed: ReadonlySet<string> = new Set()): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  function visit(node: TreeNode, prefix: string, isLast: boolean): void {
    const branch = isLast ? '└' : '├'
    const folded = node.kind === 'dir' && collapsed.has(node.path)
    rows.push({
      id: `${node.kind}:${node.path}`,
      name: node.name,
      path: node.path,
      kind: node.kind,
      gutter: prefix + branch,
      collapsed: folded
    })
    if (folded) return
    const childPrefix = `${prefix}${isLast ? ' ' : '│'}`
    node.children.forEach((child, index) => {
      visit(child, childPrefix, index === node.children.length - 1)
    })
  }
  nodes.forEach((node, index) => visit(node, '', index === nodes.length - 1))
  return rows
}
