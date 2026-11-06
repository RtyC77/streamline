export const BACKGROUND_TIMEOUT_MS = 10 * 60_000;
export const BACKGROUND_LEAVE_MESSAGE =
  "Você saiu da sala após 10 minutos com a aba em segundo plano. Clique em Entrar na sala para voltar.";
type VisibilitySource = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

/** Uses elapsed time so resuming a suspended tab cannot renew an expired stay. */
export class BackgroundTimeout {
  private hiddenAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private expired = false;
  constructor(
    private source: VisibilitySource,
    private exempt: () => boolean,
    private expire: () => void,
  ) {
    source.addEventListener("visibilitychange", this.onVisibility);
    this.refresh();
  }
  private onVisibility = () => {
    this.refresh();
  };
  refresh(): boolean {
    if (this.stopped || this.expired) return this.expired;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const exempt = this.exempt();
    if (
      !exempt &&
      this.hiddenAt !== null &&
      Date.now() - this.hiddenAt >= BACKGROUND_TIMEOUT_MS
    ) {
      this.expired = true;
      this.source.removeEventListener("visibilitychange", this.onVisibility);
      this.expire();
      return true;
    }
    if (exempt || this.source.visibilityState !== "hidden") {
      this.hiddenAt = null;
      return false;
    }
    this.hiddenAt ??= Date.now();
    this.timer = setTimeout(
      this.onVisibility,
      Math.max(0, BACKGROUND_TIMEOUT_MS - (Date.now() - this.hiddenAt)),
    );
    return false;
  }
  dispose() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.source.removeEventListener("visibilitychange", this.onVisibility);
  }
}
