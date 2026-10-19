import { createContext, useContext, useEffect } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "@/theme";

// Drag-to-reorder like the web's sortable.ts: the lifted row follows the finger, the rows it
// passes slide out of its way, and it glides into its slot on release. Rows are absolutely
// positioned from a shared order, so the new order shows at once and nothing jumps back.

const SLIDE_MS = 200;
const DROP_MS = 180;
const EDGE = 80;
const EDGE_SPEED = 12;

type Drag = {
  order: SharedValue<string[]>;
  heights: SharedValue<Record<string, number>>;
  active: SharedValue<string | null>;
  /** The lifted row's top, in list coordinates. */
  activeTop: SharedValue<number>;
  /** Where the finger is on screen, for scrolling near the edges. */
  pointerY: SharedValue<number>;
  /** The lifted row's top when the drag started, less the scroll offset then. */
  startTop: SharedValue<number>;
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
}: {
  items: T[];
  keyOf: (item: T) => string;
  onReorder: (keys: string[]) => void;
  /** Renders one row; put `<DragHandle>` somewhere inside it. */
  renderRow: (item: T, index: number) => React.ReactNode;
  /** How far the lifted row's card reaches past the row on each side, clipping what bleeds further. */
  liftInset?: number;
}) {
  const scroll = useContext(ScrollContext)!;
  const keys = items.map(keyOf);
  const keysId = keys.join("\n");
  const order = useSharedValue(keys);
  const heights = useSharedValue<Record<string, number>>({});
  const active = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0);
  const pointerY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const translation = useSharedValue(0);

  // Follow the list from outside (server refresh, removals) except mid-drag.
  useEffect(() => {
    if (active.get() === null) order.set(keysId ? keysId.split("\n") : []);
  }, [keysId, order, active]);

  // Near the top or bottom edge, scroll and keep the lifted row under the finger.
  useFrameCallback(() => {
    if (active.get() === null) return;
    const y = pointerY.get();
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

  /** Places the lifted row under the finger and moves it to the slot its centre is over. */
  function reflow(offset: number) {
    "worklet";
    const key = active.get();
    if (key === null) return;
    const sizes = heights.get();
    const top = startTop.get() + translation.get() + offset;
    activeTop.set(top);
    const centre = top + (sizes[key] ?? 0) / 2;
    const others = order.get().filter((k) => k !== key);
    let at = 0;
    let y = 0;
    for (const k of others) {
      const kh = sizes[k] ?? 0;
      if (centre > y + kh / 2) at++;
      y += kh;
    }
    if (at !== order.get().indexOf(key)) {
      others.splice(at, 0, key);
      order.set(others);
    }
  }

  const drag: Drag = {
    order,
    heights,
    active,
    activeTop,
    pointerY,
    startTop,
    translation,
    scroll: scroll.offset,
    commit: onReorder,
  };
  const listStyle = useAnimatedStyle(() => {
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
  const { order, heights, active, activeTop } = drag;
  const style = useAnimatedStyle(() => {
    const measured = heights.value[id] !== undefined;
    if (active.value === id) {
      return {
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
    const top = topOf(order.value, heights.value, id);
    return {
      top: active.value === null && !measured ? top : withTiming(top, { duration: active.value === null ? DROP_MS : SLIDE_MS }),
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
        style={[{ position: "absolute" }, style]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
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
  const { order, heights, active, activeTop, pointerY, startTop, translation, scroll, commit } = drag;

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      const top = topOf(order.get(), heights.get(), id);
      startTop.set(top - scroll.get());
      translation.set(0);
      activeTop.set(top);
      pointerY.set(e.absoluteY);
      active.set(id);
    },
    onUpdate: (e) => {
      translation.set(e.translationY);
      pointerY.set(e.absoluteY);
      reflow(scroll.get());
    },
    onFinalize: () => {
      if (active.get() !== id) return;
      const keys = [...order.get()];
      activeTop.set(
        withTiming(topOf(keys, heights.get(), id), { duration: DROP_MS }, () => {
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
