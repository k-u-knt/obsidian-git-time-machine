export interface Version {
  hash: string;
  time: Date;
  /** Repo-relative path of the file at this commit (differs from today's path before a rename). */
  path: string;
  /** Set on the commit that renamed the file: its path just before this commit. */
  fromPath?: string;
  added: number;
  removed: number;
}
