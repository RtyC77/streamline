import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundTimeout,
  BACKGROUND_TIMEOUT_MS,
} from "../src/services/background-timeout";
class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  show(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("Saída após dez minutos em segundo plano", () => {
  it("sai uma única vez ao completar o prazo", () => {
    const page = new Page(),
      expire = vi.fn();
    const timer = new BackgroundTimeout(page, () => false, expire);
    page.show("hidden");
    vi.advanceTimersByTime(BACKGROUND_TIMEOUT_MS - 1);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    page.show("visible");
    timer.refresh();
    expect(expire).toHaveBeenCalledTimes(1);
    timer.dispose();
  });
  it("zera o prazo quando o espectador retorna antes de dez minutos", () => {
    const page = new Page(),
      expire = vi.fn();
    const timer = new BackgroundTimeout(page, () => false, expire);
    page.show("hidden");
    vi.advanceTimersByTime(9 * 60_000);
    page.show("visible");
    vi.advanceTimersByTime(20 * 60_000);
    page.show("hidden");
    vi.advanceTimersByTime(9 * 60_000);
    expect(expire).not.toHaveBeenCalled();
    timer.dispose();
  });
  it("confere o tempo real ao retomar uma aba suspensa", () => {
    const page = new Page(),
      expire = vi.fn();
    const timer = new BackgroundTimeout(page, () => false, expire);
    page.show("hidden");
    vi.setSystemTime(Date.now() + BACKGROUND_TIMEOUT_MS + 1);
    page.show("visible");
    expect(expire).toHaveBeenCalledOnce();
    timer.dispose();
  });
  it("preserva o transmissor e conta um prazo novo depois da parada", () => {
    const page = new Page(),
      expire = vi.fn();
    let sharing = true;
    const timer = new BackgroundTimeout(page, () => sharing, expire);
    page.show("hidden");
    vi.advanceTimersByTime(30 * 60_000);
    expect(expire).not.toHaveBeenCalled();
    sharing = false;
    timer.refresh();
    vi.advanceTimersByTime(BACKGROUND_TIMEOUT_MS);
    expect(expire).toHaveBeenCalledOnce();
    timer.dispose();
  });
  it("cancela uma contagem anterior ao começar a transmitir", () => {
    const page = new Page(),
      expire = vi.fn();
    let sharing = false;
    const timer = new BackgroundTimeout(page, () => sharing, expire);
    page.show("hidden");
    vi.advanceTimersByTime(9 * 60_000);
    sharing = true;
    timer.refresh();
    vi.advanceTimersByTime(30 * 60_000);
    expect(expire).not.toHaveBeenCalled();
    timer.dispose();
  });
  it("remove timer e listener ao sair da sala", () => {
    const page = new Page(),
      expire = vi.fn();
    const timer = new BackgroundTimeout(page, () => false, expire);
    page.show("hidden");
    timer.dispose();
    page.show("hidden");
    vi.advanceTimersByTime(BACKGROUND_TIMEOUT_MS * 2);
    expect(expire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
