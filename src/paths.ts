import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserError } from './errors.js';
const within = (root: string, path: string) => { const r = relative(root, path); return r === '' || r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
/** Local-file capability boundary, not protection against a hostile process sharing the same user. */
export class FileAccess {
  constructor(private readonly roots: string[], private readonly output: string) {}
  async input(path: string): Promise<string> {
    const real = await realpath(resolve(path));
    const roots = await Promise.all(this.roots.map(p => realpath(resolve(p))));
    if (!roots.some(root => within(root, real))) throw new BrowserError('FILE_ACCESS_DENIED', 'Input file is outside the configured file roots.');
    if (!(await lstat(real)).isFile()) throw new BrowserError('FILE_ACCESS_DENIED', 'Expected a regular input file.');
    return real;
  }
  async outputPath(filename: string): Promise<string> {
    const configured = resolve(this.output), lexical = resolve(configured, filename);
    if (!within(configured, lexical) || lexical === configured) throw new BrowserError('FILE_ACCESS_DENIED', 'Output must be inside the configured artifact directory.');
    await mkdir(configured, { recursive: true, mode: 0o700 });
    const root = await realpath(configured), target = resolve(root, relative(configured, lexical));
    let current = root;
    for (const segment of relative(root, dirname(target)).split(sep).filter(Boolean)) {
      current = join(current, segment);
      try { await mkdir(current, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BrowserError('FILE_ACCESS_DENIED', 'Artifact directories must not traverse symlinks.');
    }
    try { await lstat(target); throw new BrowserError('FILE_ACCESS_DENIED', 'Artifact path already exists. Choose a new filename.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return target;
  }
  async write(data: string | Buffer, filename: string | undefined, extension: string): Promise<string> {
    const path = await this.outputPath(filename ?? `${randomUUID()}.${extension}`);
    await writeFile(path, data, { mode: 0o600, flag: 'wx' });
    return path;
  }
}
