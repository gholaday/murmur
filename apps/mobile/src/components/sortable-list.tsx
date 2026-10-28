import { createContext, useContext, useEffect } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  measure,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { dragEndHaptic, dragStartHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme";

// Drag-to-reorder like the web's sortable.ts: the lifted row follows the finger, the rows it
// passes slide out of its way, and it glides into its slot on release. Rows are absolutely
// positioned from a shared order, so the new order shows at once and nothing jumps back.

const SLIDE_MS = 160;
const DROP_MS = 180;
// The web's curve: most of the way at once, then easing in. Reanimated's default starts slowly,
// so on a quick drag the rows lagged behind the finger.
const SLIDE = { duration: SLIDE_MS, easing: Easing.bezier(0.2, 0, 0, 1) };
const DROP = { duration: DROP_MS, easing: Easing.bezier(0.2, 0, 0, 1) };
const EDGE = 80;
const EDGE_SPEED = 12;

type Drag = {
  order: SharedValue<string[]>;
  heights: SharedValue<Record<string, number>>;
  /** Every row has been measured once, so rows can glide; until then they're hidden and placed directly. */
  ready: SharedValue<boolean>;
  active: SharedValue<string | null>;
  /** The lifted row's top, in list coordinates. */
  activeTop: SharedValue<number>;
  /** Where the finger is on screen, for scrolling near the edges. */
  pointerY: SharedValue<number>;
  /** The lifted row's top when the drag started, less the scroll offset then. */
  startTop: SharedValue<number>;
  /** The lifted row's top when the drag started, in list coordinates; tells up from down. */
  originTop: SharedValue<number>;
  translation: SharedValue<number>;
  scroll: SharedValue<number>;
  commit: (keys: string[]) => void;
};

const DragContext = createContext<Drag | null>(null);

type Scroll = {
  ref: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  offset: SharedValue<number>;
  viewport: SharedValue<number>;
  content: SharedValue<number>;
};
export type SortableScroll = Scroll;
const ScrollContext = createContext<Scroll | null>(null);

/** A scroll view that a SortableList inside can scroll while a row is dragged near its edges. */
export function SortableScrollView({ children, ...rest }: React.ComponentProps<typeof Animated.ScrollView>) {
  const { scroll, props } = useSortableScroll<Animated.ScrollView>();
  return (
    <SortableScrollProvider value={scroll}>
      <Animated.ScrollView {...rest} {...props}>
        {children}
      </Animated.ScrollView>
    </SortableScrollProvider>
  );
}

/**
 * The same for any other Animated scrollable (e.g. Animated.FlatList): spread `props` on it and
 * wrap it in `<SortableScrollProvider value={scroll}>`.
 */
export function useSortableScroll<T extends object>() {
  const ref = useAnimatedRef<T>();
  // Reanimated scrolls FlatLists through the same ref as ScrollViews.
  const scrollRef = ref as unknown as Scroll["ref"];
  const offset = useScrollOffset(scrollRef);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const scroll: Scroll = { ref: scrollRef, offset, viewport, content };
  const props = {
    ref,
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => viewport.set(e.nativeEvent.layout.height),
    onContentSizeChange: (_: number, h: number) => content.set(h),
  };
  return { scroll, props };
}

export const SortableScrollProvider = ScrollContext.Provider;

function topOf(order: string[], heights: Record<string, number>, key: string) {
  "worklet";
  let top = 0;
  for (const k of order) {
    if (k === key) return top;
    top += heights[k] ?? 0;
  }
  return top;
}

export function SortableList<T>({
  items,
  keyOf,
  onReorder,
  renderRow,
  liftInset = 0,
  locked = false,
}: {
  items: T[];
  keyOf: (item: T) => string;
  onReorder: (keys: string[]) => void;
  /** Renders one row; put `<DragHandle>` somewhere inside it. */
  renderRow: (item: T, index: number) => React.ReactNode;
  /** How far the lifted row's card reaches past the row on each side, clipping what bleeds further. */
  liftInset?: number;
  /**
   * Rows sit in plain flow and can't be dragged. Rendering the same list locked and unlocked
   * keeps the rows (and their images) mounted when reordering is switched on.
   */
  locked?: boolean;
}) {
  const scroll = useContext(ScrollContext)!;
  const keys = items.map(keyOf);
  const keysId = keys.join("\n");
  const order = useSharedValue(keys);
  const heights = useSharedValue<Record<string, number>>({});
  const unlocked = useSharedValue(!locked);
  const ready = useSharedValue(false);
  const active = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0);
  const pointerY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const originTop = useSharedValue(0);
  const translation = useSharedValue(0);

  // Follow the list from outside (server refresh, removals) except mid-drag. Locking goes in
  // the same step, so the list never pins itself before new rows are in the order.
  useEffect(() => {
    if (active.get() === null) order.set(keysId ? keysId.split("\n") : []);
    unlocked.set(!locked);
    if (locked) ready.set(false);
  }, [keysId, locked, order, active, unlocked, ready]);

  // Rows measure one by one on mount; until all are, they stay in plain flow. Then each is
  // pinned where it is, and only later moves glide (see Row).
  useAnimatedReaction(
    () => unlocked.get() && !ready.get() && order.get().every((k) => heights.get()[k] !== undefined),
    (measured) => {
      if (measured) ready.set(true);
    },
  );

  /**
   * Places the lifted row under the finger and moves it past each row whose middle its leading
   * edge has crossed: its top going up, its bottom going down. Comparing centres instead would
   * keep a tall row from ever passing a shorter one at the top or bottom of the list.
   * A const above the frame callback, not a hoisted function: the worklets plugin turns a worklet
   * declaration into an assignment, so a callback built before it captured it as undefined and
   * crashed the app the moment a drag reached an edge.
   */
  const reflow = (offset: number) => {
    "worklet";
    const key = active.get();
    if (key === null) return;
    const sizes = heights.get();
    const top = startTop.get() + translation.get() + offset;
    activeTop.set(top);
    const edge = top < originTop.get() ? top : top + (sizes[key] ?? 0);
    const others = order.get().filter((k) => k !== key);
    let at = 0;
    let y = 0;
    for (const k of others) {
      const kh = sizes[k] ?? 0;
      if (edge > y + kh / 2) at++;
      y += kh;
    }
    if (at !== order.get().indexOf(key)) {
      others.splice(at, 0, key);
      order.set(others);
    }
  };

  // Near the top or bottom edge, scroll and keep the lifted row under the finger.
  useFrameCallback(() => {
    if (active.get() === null) return;
    // The finger's place within the scroll view, which in a sheet starts well down the screen.
    const y = pointerY.get() - (measure(scroll.ref)?.pageY ?? 0);
    const viewport = scroll.viewport.get();
    let delta = 0;
    if (y < EDGE) delta = -EDGE_SPEED * (1 - Math.max(0, y) / EDGE);
    else if (y > viewport - EDGE) delta = EDGE_SPEED * (1 - Math.max(0, viewport - y) / EDGE);
    if (!delta) return;
    const max = Math.max(0, scroll.content.get() - viewport);
    const next = Math.min(max, Math.max(0, scroll.offset.get() + delta));
    if (next === scroll.offset.get()) return;
    scrollTo(scroll.ref, 0, next, false);
    reflow(next);
  });

  const drag: Drag = {
    order,
    heights,
    ready,
    active,
    activeTop,
    pointerY,
    startTop,
    originTop,
    translation,
    scroll: scroll.offset,
    commit: onReorder,
  };
  const listStyle = useAnimatedStyle(() => {
    // Rows sit in normal flow until measured, sizing the list themselves.
    if (!ready.value) return { height: "auto" as const };
    let total = 0;
    for (const k of order.value) total += heights.value[k] ?? 0;
    return { height: total };
  });

  return (
    <DragContext.Provider value={drag}>
      <ReflowContext.Provider value={reflow}>
        <Animated.View style={listStyle}>
          {items.map((item, i) => (
            <Row key={keys[i]} id={keys[i]!} liftInset={liftInset}>
              {renderRow(item, i)}
            </Row>
          ))}
        </Animated.View>
      </ReflowContext.Provider>
    </DragContext.Provider>
  );
}

const ReflowContext = createContext<(offset: number) => void>(() => undefined);
const RowKey = createContext("");

function Row({ id, liftInset, children }: { id: string; liftInset: number; children: React.ReactNode }) {
  const t = useTheme();
  const drag = useContext(DragContext)!;
  const { order, heights, ready, active, activeTop } = drag;
  // Where the row sits, -1 until pinned. Its first place is set directly and later ones glide,
  // from a reaction rather than a timer: a frame can be skipped (a sheet opening in a new window
  // is one), and gliding then would slide every row in from the top.
  const top = useSharedValue(-1);
  useAnimatedReaction(
    () => (ready.value && heights.value[id] !== undefined ? topOf(order.value, heights.value, id) : null),
    (target) => {
      if (target === null) top.value = -1;
      else if (top.value < 0) top.value = target;
      else top.value = withTiming(target, active.value === null ? DROP : SLIDE);
    },
  );
  const style = useAnimatedStyle(() => {
    const measured = heights.value[id] !== undefined;
    // Until every row is measured they lay out in order as plain views, so the list shows at
    // once; then each is pinned absolutely at the same spot.
    if (!ready.value) return { position: "relative", top: 0 };
    if (active.value === id) {
      return {
        position: "absolute",
        top: activeTop.value,
        // Wider by liftInset each side, padded back in, so the content stays put inside a roomier card.
        left: -liftInset,
        right: -liftInset,
        paddingHorizontal: liftInset,
        overflow: liftInset ? "hidden" : "visible",
        zIndex: 10,
        opacity: 1,
        backgroundColor: t.surface2,
        borderRadius: 14,
        elevation: 8,
        transform: [{ scale: withTiming(1.02, { duration: 120 }) }],
      };
    }
    return {
      position: "absolute",
      top: Math.max(0, top.value),
      left: 0,
      right: 0,
      paddingHorizontal: 0,
      overflow: "visible",
      zIndex: 0,
      opacity: measured ? 1 : 0,
      backgroundColor: "transparent",
      borderRadius: 14,
      elevation: 0,
      transform: [{ scale: withTiming(1, { duration: 120 }) }],
    };
  });
  return (
    <RowKey.Provider value={id}>
      <Animated.View
        style={[{ left: 0, right: 0 }, style]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          // A sheet's first layout pass reports rows 0 high; counting that as measured pins them
          // all at the top, and they then glide down to their places.
          if (h === 0) return;
          // Rows lay out together; merging on the UI thread keeps one row's write from dropping another's.
          heights.modify((sizes) => {
            "worklet";
            sizes[id] = h;
            return sizes;
          });
        }}
      >
        {children}
      </Animated.View>
    </RowKey.Provider>
  );
}

/** The grip that lifts its row. Dragging anywhere else scrolls the list as usual. */
export function DragHandle({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useContext(RowKey);
  const drag = useContext(DragContext)!;
  const reflow = useContext(ReflowContext);
  const { order, heights, active, activeTop, pointerY, startTop, originTop, translation, scroll, commit } = drag;

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      const top = topOf(order.get(), heights.get(), id);
      startTop.set(top - scroll.get());
      originTop.set(top);
      translation.set(0);
      activeTop.set(top);
      pointerY.set(e.absoluteY);
      active.set(id);
      scheduleOnRN(dragStartHaptic);
    },
    onUpdate: (e) => {
      translation.set(e.translationY);
      pointerY.set(e.absoluteY);
      reflow(scroll.get());
    },
    onFinalize: () => {
      if (active.get() !== id) return;
      const keys = [...order.get()];
      scheduleOnRN(dragEndHaptic);
      activeTop.set(
        withTiming(topOf(keys, heights.get(), id), DROP, () => {
          active.set(null);
          scheduleOnRN(commit, keys);
        }),
      );
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <View accessible accessibilityLabel={label} hitSlop={4} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        {children}
      </View>
    </GestureDetector>
  );
}
