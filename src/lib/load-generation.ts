/**
 * Tells a response whether the list it belongs to is still the one on screen: every reload starts a
 * new generation, so a page requested before it (or an older reload) is dropped when it arrives.
 */
export class LoadGeneration {
  private current = 0;
  /** A reload is starting: earlier requests become stale. Returns this reload's token. */
  restart(): number {
    return ++this.current;
  }
  /** Token for a request that belongs to the list as it is now (e.g. "load more"). */
  peek(): number {
    return this.current;
  }
  isCurrent(token: number): boolean {
    return token === this.current;
  }
}
