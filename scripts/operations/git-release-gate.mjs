import {execFileSync} from 'node:child_process';

export function assertProductionSource(root) {
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  if (git(['status', '--porcelain']))
    throw new Error('Production requires a clean committed working tree. Complete the GitHub PR and CI first.');
  const head = git(['rev-parse', 'HEAD']);
  const remoteMain = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (head !== remoteMain)
    throw new Error('Production must use the merged origin/main commit. Complete GitHub maintenance before deploying.');
  return head;
}
