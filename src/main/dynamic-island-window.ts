import { isDeepStrictEqual } from "node:util";
import type {
  DynamicIslandAction,
  DynamicIslandNotchSize,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  DynamicIslandWindowPosition,
} from "@openbot/contracts/ipc";
import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  dynamicIslandCompactHeight,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import type { BrowserWindow, Display, Rectangle } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import type { CriticalAction } from "./dynamic-island-actions";
import {
  type DynamicIslandPositions,
  readDynamicIslandPositions,
  writeDynamicIslandPositions,
} from "./dynamic-island-position-store";
import { readDynamicIslandPreference, writeDynamicIslandPreference } from "./dynamic-island-preference-store";
import { sendToRenderer } from "./renderer-ipc";

/** The idle island comes back over about 160 ms after the voice island leaves the notch. */
const ISLAND_RETURN_STEPS = 8;
const ISLAND_RETURN_STEP_MS = 20;

const logger = createOpenBotLogger("dynamic-island-window");

const DYNAMIC_ISLAND_WINDOW_SIZE = { width: 614, height: 380 } as const;
const DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT = 50;
// Room below the compact island for its hover growth and hit band, which the window must not clip.
const DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM = 18;
// Leaving interaction starts a collapse the renderer animates for roughly 600ms: the panel fades,
// then the shell springs back down to the notch. The window is the only thing clipping it, so
// dropping to the compact height on the same tick guillotines the still-tall island - the lower
// half disappears at once while the top morphs. Hold the tall window until the shell has landed.
const DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS = 700;

const MACBOOK_NOTCH_REFERENCE = {
  displayWidth: 1512,
  displayHeight: 982,
  notchWidth: 185,
  notchHeight: 32,
} as const;
const MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE = 0.01;

/** A Dynamic Island operation that failed. The cause is what the renderer reads. */
export class DynamicIslandFailed extends Schema.TaggedError<DynamicIslandFailed>()("DynamicIslandFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toDynamicIslandFailed } = causeHelpers(DynamicIslandFailed);

export interface DynamicIslandWindowControllerOptions {
  platform: NodeJS.Platform;
  preferencePath: string;
  /** Where each display's last dragged window position is remembered. */
  positionPath: string;
  createWindow: (bounds: Rectangle, display: Display) => BrowserWindow;
  loadWindow: (window: BrowserWindow, display: Display) => Promise<void>;
  getDisplays: () => Display[];
  /** The display that shows the island when additional displays are off on a computer with no
   *  built-in-display flag, such as Windows. */
  getPrimaryDisplayId: () => number;
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  performHaptic: () => void;
  performCriticalAction: (action: CriticalAction) => Effect.Effect<void, DynamicIslandFailed>;
  logger?: Logger;
}

export class DynamicIslandWindowController {
  readonly #options: DynamicIslandWindowControllerOptions;
  #preference: DynamicIslandPreference = { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  #presentation = IDLE_DYNAMIC_ISLAND_PRESENTATION;
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #interactiveDisplays = new Set<number>();
  /** Where each window is while the user drags it, before the drag ends and the move is saved. */
  readonly #dragPositions = new Map<number, DynamicIslandWindowPosition>();
  readonly #draggingDisplays = new Set<number>();
  #positions: DynamicIslandPositions = new Map();
  /** One run per critical action, shared by the overlays and IPC retries that send it again. */
  readonly #criticalActions = new Map<string, Deferred.Deferred<void, DynamicIslandFailed>>();
  readonly #notchSizes = new Map<number, { width: number; height: number }>();
  readonly #collapseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly #preferenceMutation = Semaphore.makeUnsafe(1);
  readonly #positionWrites = Semaphore.makeUnsafe(1);
  readonly #windowReconciliation = Semaphore.makeUnsafe(1);
  #destroyed = false;

  constructor(options: DynamicIslandWindowControllerOptions) {
    this.#options = options;
  }

  readonly initialize = Effect.fn("DynamicIsland.initialize")(function* (this: DynamicIslandWindowController) {
    this.#preference = yield* readDynamicIslandPreference(this.#options.preferencePath);
    this.#positions = yield* readDynamicIslandPositions(this.#options.positionPath);
    yield* this.reconcileWindow();
  }).bind(this);

  get preference(): DynamicIslandPreference {
    return { ...this.#preference };
  }

  get presentation(): DynamicIslandPresentation {
    return this.#presentation;
  }

  /** The notch of the built-in display, or null when there is no built-in display or it has no notch. */
  get builtInDisplayGeometry(): DynamicIslandNotchSize | null {
    const builtIn = this.#options.getDisplays().find((display) => display.internal);
    return (builtIn && dynamicIslandNotchSizeForDisplay(builtIn)) ?? null;
  }

  get mainRendererIds(): ReadonlySet<number> {
    const window = this.#options.getMainWindow();
    return new Set(window && !window.isDestroyed() ? [window.webContents.id] : []);
  }

  get overlayRendererIds(): ReadonlySet<number> {
    return new Set(
      [...this.#windows.values()].filter((window) => !window.isDestroyed()).map((window) => window.webContents.id),
    );
  }

  /** Writes run in the order of the calls; each one reconciles the windows before the next. */
  setPreference(preference: DynamicIslandPreference): Effect.Effect<DynamicIslandPreference, DynamicIslandFailed> {
    return this.#preferenceMutation.withPermit(
      Effect.gen({ self: this }, function* () {
        const savedPreference = yield* writeDynamicIslandPreference(this.#options.preferencePath, preference).pipe(
          toDynamicIslandFailed,
        );
        this.#preference = savedPreference;
        yield* this.reconcileWindow();
        this.publishPreference();
        return { ...savedPreference };
      }),
    );
  }

  #yielding = false;

  /**
   * While the global voice island is up it is the one island at the notch: this idle pill fades out
   * under it, so nothing shows through or beside it, and comes back when the voice island hides.
   */
  #returnFade: ReturnType<typeof setInterval> | undefined;

  yieldToVoiceIsland(yielding: boolean): void {
    this.#yielding = yielding;
    clearInterval(this.#returnFade);
    this.#returnFade = undefined;
    const windows = [...this.#windows.values()].filter((window) => !window.isDestroyed());
    // Gone at once when the voice island takes the notch; back with a short fade, not a pop.
    if (yielding) {
      for (const window of windows) window.setOpacity(0);
      return;
    }
    let step = 0;
    this.#returnFade = setInterval(() => {
      step += 1;
      const opacity = Math.min(1, step / ISLAND_RETURN_STEPS);
      for (const window of windows) if (!window.isDestroyed()) window.setOpacity(opacity);
      if (opacity >= 1) {
        clearInterval(this.#returnFade);
        this.#returnFade = undefined;
      }
    }, ISLAND_RETURN_STEP_MS);
  }

  performHaptic(): void {
    if (this.#options.platform !== "darwin") return;
    if (!this.#preference.enabled || !this.#preference.hapticsEnabled) return;
    this.#options.performHaptic();
  }

  publish(presentation: DynamicIslandPresentation): void {
    if (isDeepStrictEqual(this.#presentation, presentation)) return;
    this.#presentation = presentation;
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, presentation);
    }
  }

  setInteractive(rendererId: number, interactive: boolean, keyboard = false): void {
    const entry = this.#windowEntry(rendererId);
    if (!entry) return;
    const [displayId, window] = entry;
    // A drag keeps the pointer on the window even when it leaves the drawn island, or the
    // pointerup that ends the drag would go to the app under the pointer.
    if (this.#draggingDisplays.has(displayId)) return;
    if (interactive) this.#interactiveDisplays.add(displayId);
    else this.#interactiveDisplays.delete(displayId);
    const display = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
    const bounds = display ? this.#boundsForDisplay(display, interactive) : undefined;
    this.#cancelCollapse(displayId);
    if (interactive && bounds) window.setBounds(bounds, false);
    window.setIgnoreMouseEvents(!interactive, { forward: true });
    // On macOS, focusability also allows the panel to become a main window in AltTab. The panel is
    // focusable only while a text field on it needs key input. A panel becomes key without
    // activating the app, so the main window stays where it is.
    const wantsKeyboard = interactive && keyboard;
    window.setFocusable(wantsKeyboard);
    if (wantsKeyboard && !window.isFocused()) window.focus();
    if (interactive || !bounds) return;
    this.#collapseTimers.set(
      displayId,
      setTimeout(() => {
        this.#collapseTimers.delete(displayId);
        if (this.#interactiveDisplays.has(displayId) || window.isDestroyed()) return;
        // The display can be rearranged while the island animates shut, and reconciliation will
        // have moved the still-tall window to the new geometry. Ask where the window belongs now
        // rather than replaying the rectangle captured when the pointer left.
        const current = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
        if (!current) return;
        window.setBounds(this.#boundsForDisplay(current, false), false);
      }, DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS),
    );
  }

  /** Moves the window to the pointer during a drag. Main keeps the window on its display. */
  moveWindow(rendererId: number, position: DynamicIslandWindowPosition): void {
    if (this.#destroyed) return;
    const entry = this.#windowEntry(rendererId);
    if (!entry) return;
    const [displayId, window] = entry;
    if (window.isDestroyed()) return;
    const display = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
    if (!display) return;
    this.#draggingDisplays.add(displayId);
    this.#interactiveDisplays.add(displayId);
    this.#cancelCollapse(displayId);
    const current = window.getBounds();
    // The island is compact while it is dragged, so the room below it counts from that height:
    // the taller panel that a hover shows can pass the screen edge and is cut at the edge.
    const clamped = clampDynamicIslandPosition(
      position,
      display,
      DYNAMIC_ISLAND_WINDOW_SIZE.width,
      DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT,
    );
    this.#dragPositions.set(displayId, {
      ...clamped,
      ...(position.islandWidth === undefined ? {} : { islandWidth: position.islandWidth }),
    });
    window.setBounds({ ...current, x: clamped.x, y: clamped.y }, false);
  }

  /** Ends a drag and saves the window position for this display. A failed write is only logged. */
  endWindowDrag(rendererId: number): Effect.Effect<void> {
    return Effect.suspend(() => {
      const entry = this.#windowEntry(rendererId);
      if (!entry) return Effect.void;
      const [displayId, window] = entry;
      this.#draggingDisplays.delete(displayId);
      this.#cancelCollapse(displayId);
      const islandWidth =
        this.#dragPositions.get(displayId)?.islandWidth ?? this.#positions.get(displayId)?.islandWidth;
      this.#dragPositions.delete(displayId);
      if (!window.isDestroyed()) {
        const bounds = window.getBounds();
        this.#positions = new Map(this.#positions).set(displayId, {
          x: bounds.x,
          y: bounds.y,
          ...(islandWidth === undefined ? {} : { islandWidth }),
        });
      }
      return this.#positionWrites.withPermit(
        writeDynamicIslandPositions(this.#options.positionPath, this.#positions).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              (this.#options.logger ?? logger).error(
                "Unable to save the Dynamic Island position:",
                toLogValue(error.cause),
              ),
            ),
          ),
        ),
      );
    });
  }

  #windowEntry(rendererId: number): [number, BrowserWindow] | undefined {
    return [...this.#windows].find(
      ([, candidate]) => !candidate.isDestroyed() && candidate.webContents.id === rendererId,
    );
  }

  #boundsForDisplay(display: Display, interactive: boolean): Rectangle {
    const base = this.#windowBounds(display, dynamicIslandWindowBounds(display), interactive);
    const position = this.#dragPositions.get(display.id) ?? this.#positions.get(display.id);
    if (!position) return base;
    const clamped = clampDynamicIslandPosition(position, display, base.width, DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT);
    return { ...base, x: clamped.x, y: clamped.y };
  }

  #windowBounds(display: Pick<Display, "bounds" | "internal">, bounds: Rectangle, interactive: boolean): Rectangle {
    if (interactive) return bounds;
    const compactHeight = dynamicIslandCompactHeight(
      notchSizeForDisplay(display)?.height,
      this.#preference.heightPercent,
    );
    return {
      ...bounds,
      height: Math.max(DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT, compactHeight + DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM),
    };
  }

  #cancelCollapse(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  performAction(action: DynamicIslandAction): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.suspend(() => {
      if (
        action.type === "answer-prompt" ||
        action.type === "respond-approval" ||
        action.type === "send-message" ||
        action.type === "stop-agent"
      ) {
        return this.#performCriticalAction(action);
      }
      return Effect.gen({ self: this }, function* () {
        const window = yield* this.#ensureMainWindow();
        // A dismissal changes only the island, so the main window stays where it is.
        if (action.type !== "dismiss-failure") this.#options.presentMainWindow(window);
        if (action.type !== "open-app" && !sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action)) {
          return yield* new DynamicIslandFailed({
            cause: new Error(sourceText("error.backend.windowTemporarilyUnavailable")),
          });
        }
      });
    });
  }

  #performCriticalAction(action: CriticalAction): Effect.Effect<void, DynamicIslandFailed> {
    const key = criticalActionKey(action);
    const existing = this.#criticalActions.get(key);
    if (existing) return Deferred.await(existing);
    const done = Deferred.makeUnsafe<void, DynamicIslandFailed>();
    this.#criticalActions.set(key, done);
    return Effect.gen({ self: this }, function* () {
      // The main renderer clears an answered request at once. A reply or a stop changes only the
      // agent: its events reach the main window by themselves, so the island does not need it.
      const window =
        action.type === "answer-prompt" || action.type === "respond-approval" ? yield* this.#ensureMainWindow() : null;
      yield* this.#options.performCriticalAction(action);
      if (window) sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action);
    }).pipe(
      Effect.onExit((exit) => {
        if (this.#criticalActions.get(key) === done) this.#criticalActions.delete(key);
        return Deferred.done(done, exit);
      }),
    );
  }

  #ensureMainWindow(): Effect.Effect<BrowserWindow, DynamicIslandFailed> {
    return Effect.gen({ self: this }, function* () {
      const current = this.#options.getMainWindow();
      if (current && !current.isDestroyed()) return current;
      const ensureMainWindow = this.#options.ensureMainWindow;
      const created = ensureMainWindow
        ? yield* Effect.tryPromise({
            try: () => ensureMainWindow(),
            catch: (cause) => new DynamicIslandFailed({ cause }),
          })
        : undefined;
      if (!created || created.isDestroyed()) {
        return yield* new DynamicIslandFailed({ cause: new Error(sourceText("error.backend.windowUnavailable")) });
      }
      return created;
    });
  }

  /** Reconciliations run one at a time, in the order of the calls. A window that fails to load is logged. */
  reconcileWindow(): Effect.Effect<void> {
    return this.#windowReconciliation.withPermit(this.#reconcileWindows());
  }

  readonly #reconcileWindows = Effect.fn("DynamicIsland.reconcileWindows")(function* (
    this: DynamicIslandWindowController,
  ) {
    if (this.#destroyed || !this.#preference.enabled) {
      this.destroyWindows();
      return;
    }

    const displays = this.#options
      .getDisplays()
      .filter(
        (display) =>
          this.#preference.additionalDisplaysEnabled ||
          display.internal ||
          display.id === this.#options.getPrimaryDisplayId(),
      );
    const displayIds = new Set(displays.map((display) => display.id));
    for (const [displayId, window] of this.#windows) {
      if (displayIds.has(displayId) && !window.isDestroyed()) continue;
      this.#windows.delete(displayId);
      this.#interactiveDisplays.delete(displayId);
      this.#notchSizes.delete(displayId);
      this.#cancelCollapse(displayId);
      if (!window.isDestroyed()) window.destroy();
    }

    for (const display of displays) {
      if (this.#destroyed) return;
      const notchSize = notchSizeForDisplay(display);
      const current = this.#windows.get(display.id);
      if (current && !current.isDestroyed()) {
        current.setBounds(
          this.#boundsForDisplay(
            display,
            this.#interactiveDisplays.has(display.id) || this.#collapseTimers.has(display.id),
          ),
          false,
        );
        if (notchSizeChanged(this.#notchSizes.get(display.id), notchSize)) {
          if (sendToRenderer(current, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
            this.#rememberNotchSize(display.id, notchSize);
          }
        }
        current.showInactive();
        continue;
      }
      yield* this.#createDisplayWindow(display, this.#boundsForDisplay(display, false)).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            (this.#options.logger ?? logger).error(
              `Unable to load Dynamic Island on display ${display.id}:`,
              toLogValue(error.cause),
            ),
          ),
        ),
      );
    }
  }).bind(this);

  /** A window that cannot be created or loaded fails here, so that the other displays still get theirs. */
  #createDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.try({
      try: () => this.#openDisplayWindow(display, bounds),
      catch: (cause) => new DynamicIslandFailed({ cause }),
    }).pipe(Effect.flatten);
  }

  /** Creates the window now and returns its load. */
  #openDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    const window = this.#options.createWindow(this.#windowBounds(display, bounds, false), display);
    const onMac = this.#options.platform === "darwin";
    if (onMac) window.excludedFromShownWindowsMenu = true;
    this.#windows.set(display.id, window);
    window.setHasShadow(false);
    if (onMac) {
      window.setWindowButtonVisibility(false);
      window.setAlwaysOnTop(true, "status");
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      window.setHiddenInMissionControl(true);
    } else {
      // Windows and Linux keep an always-on-top window above other apps. Their window manager
      // has no panel level or Mission Control flag to set.
      window.setAlwaysOnTop(true);
    }
    window.setFocusable(false);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.on("did-finish-load", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      const currentDisplay = this.#options.getDisplays().find((candidate) => candidate.id === display.id) ?? display;
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, this.#presentation);
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
      const notchSize = notchSizeForDisplay(currentDisplay);
      if (sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
        this.#rememberNotchSize(display.id, notchSize);
      }
    });
    window.once("ready-to-show", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      if (this.#yielding) window.setOpacity(0);
      window.showInactive();
    });
    window.on("blur", () => this.setInteractive(window.webContents.id, false));
    window.on("closed", () => {
      if (this.#windows.get(display.id) === window) {
        this.#windows.delete(display.id);
        this.#interactiveDisplays.delete(display.id);
        this.#notchSizes.delete(display.id);
        this.#draggingDisplays.delete(display.id);
        this.#dragPositions.delete(display.id);
        this.#cancelCollapse(display.id);
      }
    });
    return Effect.tryPromise({
      try: () => this.#options.loadWindow(window, display),
      catch: (cause) => new DynamicIslandFailed({ cause }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (this.#windows.get(display.id) === window) this.#windows.delete(display.id);
          this.#notchSizes.delete(display.id);
          if (!window.isDestroyed()) window.destroy();
        }),
      ),
    );
  }

  destroy(): void {
    this.#destroyed = true;
    clearInterval(this.#returnFade);
    this.destroyWindows();
  }

  private publishPreference(): void {
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
    }
  }

  #rememberNotchSize(displayId: number, notchSize: DynamicIslandNotchSize | undefined): void {
    if (notchSize) this.#notchSizes.set(displayId, notchSize);
    else this.#notchSizes.delete(displayId);
  }

  private destroyWindows(): void {
    for (const displayId of [...this.#collapseTimers.keys()]) this.#cancelCollapse(displayId);
    const windows = [...this.#windows.values()];
    this.#windows.clear();
    this.#interactiveDisplays.clear();
    this.#notchSizes.clear();
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

export function dynamicIslandNotchSizeForDisplay(
  display: Pick<Display, "bounds" | "internal">,
): DynamicIslandNotchSize | undefined {
  if (!display.internal || !isRecognizedNotchedMacBookDisplay(display)) return undefined;
  return dynamicIslandNotchSize(display);
}

function isRecognizedNotchedMacBookDisplay(display: Pick<Display, "bounds">): boolean {
  const { width, height } = display.bounds;
  if (width <= 0 || height <= 0) return false;
  const referenceAspectRatio = MACBOOK_NOTCH_REFERENCE.displayWidth / MACBOOK_NOTCH_REFERENCE.displayHeight;
  return Math.abs(width / height - referenceAspectRatio) <= MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE;
}

function notchSizeForDisplay(display: Pick<Display, "bounds" | "internal">): DynamicIslandNotchSize | undefined {
  return dynamicIslandNotchSizeForDisplay(display);
}

function notchSizeChanged(
  previous: { width: number; height: number } | undefined,
  next: { width: number; height: number } | undefined,
): boolean {
  return previous?.width !== next?.width || previous?.height !== next?.height;
}

function criticalActionKey(action: CriticalAction): string {
  const id =
    action.type === "send-message"
      ? action.clientMessageId
      : action.type === "stop-agent"
        ? action.turnId
        : String(action.requestId);
  return [action.type, action.serverId, action.agentId, id].join("\u0000");
}

/** A display without a notch gets a floating pill: the window starts just below the menu bar. */
const FLOATING_ISLAND_TOP_OFFSET = 2;

export function dynamicIslandWindowBounds(
  display: Pick<Display, "bounds" | "internal"> & Partial<Pick<Display, "workArea">>,
): Rectangle {
  const notched = dynamicIslandNotchSizeForDisplay(display) !== undefined;
  const top = display.workArea ? display.workArea.y + FLOATING_ISLAND_TOP_OFFSET : display.bounds.y;
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - DYNAMIC_ISLAND_WINDOW_SIZE.width) / 2),
    y: notched ? display.bounds.y : top,
    ...DYNAMIC_ISLAND_WINDOW_SIZE,
  };
}

/**
 * Keeps a dragged window on its display. The window is mostly transparent and only its compact
 * island is visible, so the room below it counts from `minimumVisibleHeight`, not from the tall
 * panel that a hover draws. `islandWidth` is the visible width; the transparent sides may pass the
 * screen edge, so the island itself can reach it.
 */
export function clampDynamicIslandPosition(
  position: DynamicIslandWindowPosition,
  display: Pick<Display, "bounds" | "workArea">,
  windowWidth: number,
  minimumVisibleHeight: number,
): DynamicIslandWindowPosition {
  const area = display.workArea ?? display.bounds;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const islandWidth = position.islandWidth ?? windowWidth;
  const overhang = Math.max(0, Math.min(windowWidth, Math.round((windowWidth - islandWidth) / 2)));
  // A display smaller than the window keeps the window at the top-left corner, where the
  // island's own top edge is still on screen.
  const minX = area.x - overhang;
  const maxX = Math.max(minX, right - windowWidth + overhang);
  const maxY = Math.max(area.y, bottom - minimumVisibleHeight);
  return {
    x: Math.round(Math.min(Math.max(position.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(position.y, area.y), maxY)),
  };
}

/**
 * Returns the notch size in Electron's display points.
 *
 * Apple keeps the camera housing proportional across notched MacBooks, while
 * the selected display scale changes the logical display width. Scaling the
 * measured 14-inch reference therefore covers the 13-inch Air, 14-inch Pro,
 * 15-inch Air, and 16-inch Pro without a model-name lookup.
 */
function dynamicIslandNotchSize(display: Pick<Display, "bounds">): DynamicIslandNotchSize {
  const displayScale = display.bounds.width / MACBOOK_NOTCH_REFERENCE.displayWidth;
  return {
    width: Math.max(16, Math.round(MACBOOK_NOTCH_REFERENCE.notchWidth * displayScale)),
    height: Math.max(32, Math.round(MACBOOK_NOTCH_REFERENCE.notchHeight * displayScale)),
  };
}

export function requireDynamicIslandSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) {
    throw new Error(`Rejected Dynamic Island IPC request outside the ${name}.`);
  }
}
