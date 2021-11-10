import { Dictionary, EntryHashB64 } from '@holochain-open-dev/core-types';
import { Commit } from '@syn/zome-client';

export function getLatestCommit(
  commits: Dictionary<Commit>
): [EntryHashB64, Commit] {
  const sortedCommits = Object.entries(commits).sort(
    ([_, c1], [__, c2]) => c2.createdAt - c1.createdAt
  );
  return sortedCommits[0];
}
