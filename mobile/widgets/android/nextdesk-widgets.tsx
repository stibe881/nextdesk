"use no memo";
// react-native-android-widget calls these components as plain functions to
// build a RemoteViews tree; the React Compiler must not transform them.

import type { ReactNode } from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp } from "react-native-android-widget";

import {
  countSlaBreaches,
  countSlaWarnings,
  formatSnapshotTime,
  widgetDeepLink,
  type WidgetBrandColors,
  type WidgetPriority,
  type WidgetSnapshot,
} from "@/lib/widget-snapshot";

/** Names must match the widgets of react-native-android-widget in app.config.ts. */
export const ANDROID_PRIORITIES_WIDGET = "NextDeskPriorities";
export const ANDROID_COUNTERS_WIDGET = "NextDeskCounters";
export const ANDROID_WIDGET_NAMES = [
  ANDROID_PRIORITIES_WIDGET,
  ANDROID_COUNTERS_WIDGET,
] as const;

type Palette = {
  background: ColorProp;
  surface: ColorProp;
  foreground: ColorProp;
  muted: ColorProp;
  primary: ColorProp;
  warning: ColorProp;
  error: ColorProp;
};

// Colour roles from theme.config.js (surface, foreground, muted, …).
const LIGHT: Palette = {
  background: "#FFFFFF",
  surface: "#F7F7FB",
  foreground: "#202136",
  muted: "#6E6C84",
  primary: "#4438CA",
  warning: "#8A5B0D",
  error: "#B42318",
};
const DARK: Palette = {
  background: "#181A26",
  surface: "#20232F",
  foreground: "#F3F3FA",
  muted: "#A4A3B8",
  primary: "#ABA6FF",
  warning: "#F2C062",
  error: "#FF9B91",
};

const openPriorities = {
  clickAction: "OPEN_URI",
  clickActionData: { uri: widgetDeepLink() },
} as const;

function Header({
  title,
  stand,
  c,
}: {
  title: string;
  stand: string;
  c: Palette;
}) {
  return (
    <FlexWidget
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: "match_parent",
      }}
    >
      <TextWidget
        text={title}
        style={{ color: c.primary, fontSize: 14, fontWeight: "700" }}
      />
      <TextWidget text={stand} style={{ color: c.muted, fontSize: 11 }} />
    </FlexWidget>
  );
}

function PriorityRow({ item, c }: { item: WidgetPriority; c: Palette }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: widgetDeepLink(item.id) }}
      accessibilityLabel={`Ticket ${item.ticketNumber} öffnen`}
      style={{
        width: "match_parent",
        backgroundColor: c.surface,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginTop: 6,
      }}
    >
      <TextWidget
        text={`${item.ticketNumber} · ${item.subject}`}
        maxLines={1}
        truncate="END"
        style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}
      />
      <TextWidget
        text={item.reason ?? "Ohne Begründung"}
        maxLines={1}
        truncate="END"
        style={{ color: c.muted, fontSize: 11 }}
      />
    </FlexWidget>
  );
}

function slaLabel(snapshot: WidgetSnapshot | null, now: Date) {
  const warnings = countSlaWarnings(snapshot?.slaDueAt ?? null, now);
  const breaches = countSlaBreaches(snapshot?.slaDueAt ?? null, now) ?? 0;
  return {
    value: warnings === null ? "–" : String(warnings),
    hint:
      breaches > 0
        ? `${breaches} überfällig`
        : warnings === null
          ? "unbekannt"
          : "fällig < 4 h",
    alarming: (warnings ?? 0) > 0,
  };
}

function Counter({
  label,
  value,
  hint,
  color,
  c,
}: {
  label: string;
  value: string;
  hint: string;
  color: ColorProp;
  c: Palette;
}) {
  return (
    <FlexWidget
      style={{
        flex: 1,
        height: "match_parent",
        backgroundColor: c.surface,
        borderRadius: 12,
        padding: 8,
        justifyContent: "center",
      }}
    >
      <TextWidget
        text={label}
        maxLines={1}
        style={{ color: c.muted, fontSize: 11 }}
      />
      <TextWidget
        text={value}
        style={{ color, fontSize: 26, fontWeight: "700" }}
      />
      <TextWidget
        text={hint}
        maxLines={1}
        style={{ color: c.muted, fontSize: 10 }}
      />
    </FlexWidget>
  );
}

function Counters({
  snapshot,
  now,
  c,
}: {
  snapshot: WidgetSnapshot | null;
  now: Date;
  c: Palette;
}) {
  const sla = slaLabel(snapshot, now);
  const approvals = snapshot?.approvals ?? null;
  return (
    <FlexWidget
      style={{
        flexDirection: "row",
        width: "match_parent",
        flex: 1,
        flexGap: 8,
        marginTop: 6,
      }}
    >
      <Counter
        label="SLA-Warnungen"
        value={sla.value}
        hint={sla.hint}
        color={sla.alarming ? c.error : c.foreground}
        c={c}
      />
      <Counter
        label="Freigaben"
        value={approvals === null ? "–" : String(approvals)}
        hint="warten auf dich"
        color={(approvals ?? 0) > 0 ? c.warning : c.foreground}
        c={c}
      />
    </FlexWidget>
  );
}

function Frame({ children, c }: { children: ReactNode; c: Palette }) {
  return (
    <FlexWidget
      {...openPriorities}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: c.background,
        borderRadius: 18,
        padding: 12,
      }}
    >
      {children}
    </FlexWidget>
  );
}

function EmptyHint({ text, c }: { text: string; c: Palette }) {
  return (
    <TextWidget
      text={text}
      maxLines={3}
      style={{ color: c.muted, fontSize: 12, marginTop: 8 }}
    />
  );
}

export function PrioritiesWidget({
  snapshot,
  now,
  c,
}: {
  snapshot: WidgetSnapshot | null;
  now: Date;
  c: Palette;
}) {
  const stand = snapshot ? formatSnapshotTime(snapshot.updatedAt, now) : "";
  const items = snapshot?.priorities ?? null;
  const body = !snapshot ? (
    <EmptyHint
      text="Öffne nextDesk und melde dich an, damit hier deine Prioritäten erscheinen."
      c={c}
    />
  ) : !items ? (
    <EmptyHint
      text="Öffne «Meine Prioritäten» in der App, um das Widget zu füllen."
      c={c}
    />
  ) : items.length === 0 ? (
    <EmptyHint text="Dir sind gerade keine offenen Tickets zugewiesen." c={c} />
  ) : (
    items.map((item) => <PriorityRow key={item.id} item={item} c={c} />)
  );
  const sla = slaLabel(snapshot, now);
  const approvals = snapshot?.approvals;
  return (
    <Frame c={c}>
      <Header title="Meine Prioritäten" stand={stand} c={c} />
      {body}
      <TextWidget
        text={`SLA-Warnungen: ${sla.value} · Freigaben: ${approvals ?? "–"}`}
        maxLines={1}
        style={{
          color: sla.alarming ? c.error : c.muted,
          fontSize: 11,
          marginTop: 6,
        }}
      />
    </Frame>
  );
}

export function CountersWidget({
  snapshot,
  now,
  c,
}: {
  snapshot: WidgetSnapshot | null;
  now: Date;
  c: Palette;
}) {
  const stand = snapshot
    ? formatSnapshotTime(snapshot.updatedAt, now)
    : "Öffne nextDesk";
  return (
    <Frame c={c}>
      <Header title="nextDesk" stand={stand} c={c} />
      <Counters snapshot={snapshot} now={now} c={c} />
    </Frame>
  );
}

/** Light and dark rendering of one widget for react-native-android-widget. */
/** Tenant design colours (accent and row surface) over the defaults. */
function withBrand(
  base: Palette,
  brand: WidgetBrandColors | null | undefined,
): Palette {
  if (!brand) return base;
  return {
    ...base,
    primary: brand.accent as ColorProp,
    surface: brand.surface as ColorProp,
  };
}

export function renderNextDeskWidget(
  widgetName: string,
  snapshot: WidgetSnapshot | null,
  now: Date,
) {
  const Widget =
    widgetName === ANDROID_COUNTERS_WIDGET ? CountersWidget : PrioritiesWidget;
  return {
    light: (
      <Widget
        snapshot={snapshot}
        now={now}
        c={withBrand(LIGHT, snapshot?.brand?.light)}
      />
    ),
    dark: (
      <Widget
        snapshot={snapshot}
        now={now}
        c={withBrand(DARK, snapshot?.brand?.dark)}
      />
    ),
  };
}
