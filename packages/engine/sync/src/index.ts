import { JulionOnContainer } from 'julion-core';

export interface SyncPlan {
  added: string[];
  modified: string[];
  removed: string[];
}

export function diffSnapshots(local: JulionOnContainer, remote: JulionOnContainer): SyncPlan {
  const localFiles = new Set(local.index.files);
  const remoteFiles = new Set(remote.index.files);

  const added = remote.index.files.filter((file) => !localFiles.has(file));
  const removed = local.index.files.filter((file) => !remoteFiles.has(file));
  const modified = local.index.files.filter((file) => remoteFiles.has(file) && local.checksums[file] !== remote.checksums[file]);

  return { added, modified, removed };
}
