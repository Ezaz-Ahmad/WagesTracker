import ActivityKit
import SwiftUI
import WidgetKit

private let brandGreenDark = Color(red: 0.04, green: 0.36, blue: 0.24)

@available(iOSApplicationExtension 16.1, *)
private extension ShiftActivityAttributes.ContentState.Phase {
    var title: String {
        switch self {
        case .active: return "Shift in progress"
        case .confirming: return "End this shift?"
        case .ending: return "Saving shift"
        case .retry: return "Needs attention"
        case .completed: return "Shift saved"
        }
    }

    var symbol: String {
        switch self {
        case .active: return "waveform.path"
        case .confirming: return "questionmark"
        case .ending: return "arrow.triangle.2.circlepath"
        case .retry: return "exclamationmark"
        case .completed: return "checkmark"
        }
    }

    func accent(in scheme: ColorScheme) -> Color {
        if self == .retry || self == .confirming {
            return scheme == .dark
                ? Color(red: 1, green: 0.72, blue: 0.35)
                : Color(red: 0.58, green: 0.29, blue: 0.04)
        }
        return scheme == .dark
            ? Color(red: 0.35, green: 0.88, blue: 0.70)
            : Color(red: 0.03, green: 0.43, blue: 0.31)
    }
}

@available(iOSApplicationExtension 16.1, *)
struct ShiftElapsedText: View {
    let startedAt: Date
    let endedAt: Date?
    var finalDurationSeconds: Int? = nil

    private var pauseTime: Date? {
        // Receipt time must not add hours to a delayed offline clock-out.
        if let finalDurationSeconds {
            return startedAt.addingTimeInterval(TimeInterval(max(0, finalDurationSeconds)))
        }
        return endedAt
    }

    var body: some View {
        Text(
            timerInterval: startedAt...startedAt.addingTimeInterval(48 * 60 * 60),
            pauseTime: pauseTime,
            countsDown: false,
            showsHours: true
        )
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

/// Each equal-height column holds one hour of actual elapsed shift time.
/// Built-in date-based linear progress views advance while the host is
/// suspended. TimelineView and custom ProgressViewStyle fills become stale
/// snapshots in Live Activities; keep the system-owned timer controls.
@available(iOSApplicationExtension 16.1, *)
struct ShiftHoursChart: View {
    let startedAt: Date
    let accent: Color

    var body: some View {
        VStack(spacing: 3) {
            HStack {
                Text("HOURS TRACKED")
                    .font(.system(size: 8, weight: .bold))
                    .tracking(0.7)
                Spacer()
                Text("Each bar = 1 hour")
                    .font(.system(size: 9, weight: .medium))
            }
            .foregroundStyle(.secondary)

            HStack(spacing: 4) {
                ForEach(0..<24) { hour in
                    let start = startedAt.addingTimeInterval(TimeInterval(hour * 3600))
                    GeometryReader { geometry in
                        // Rotate the built-in linear style, retaining its timer.
                        ProgressView(timerInterval: start...start.addingTimeInterval(3600), countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                        .progressViewStyle(.linear)
                        .tint(accent)
                        .frame(width: 18, height: 4)
                        .scaleEffect(x: 1, y: min(8, geometry.size.width) / 4)
                        .rotationEffect(.degrees(-90))
                        .frame(width: geometry.size.width, height: 18)
                    }
                    .frame(height: 18)
                }
            }
            .environment(\.layoutDirection, .leftToRight)

            HStack(spacing: 0) {
                Text("0h")
                Spacer(minLength: 0)
                Text("6h")
                Spacer(minLength: 0)
                Text("12h")
                Spacer(minLength: 0)
                Text("18h")
                Spacer(minLength: 0)
                Text("24h")
            }
            .font(.system(size: 8, weight: .medium, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .environment(\.layoutDirection, .leftToRight)
        }
        // The accessible, exact system timer supplies the same information.
        .accessibilityHidden(true)
    }
}

@available(iOSApplicationExtension 16.1, *)
struct ShiftActivityAction: View {
    let shiftId: String
    let phase: ShiftActivityAttributes.ContentState.Phase
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if #available(iOSApplicationExtension 17.0, *) {
                switch phase {
                case .active:
                    Button(intent: RequestShiftSignOutIntent(shiftId: shiftId)) {
                        Label("End Shift", systemImage: "stop.fill")
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(brandGreenDark)
                    .accessibilityHint("Shows confirmation before ending this shift")
                case .confirming:
                    HStack(spacing: 10) {
                        Button(intent: CancelShiftSignOutIntent(shiftId: shiftId)) {
                            Text("Keep working")
                                .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(.bordered)
                        Button(intent: EndShiftIntent(shiftId: shiftId)) {
                            Label("End Shift", systemImage: "checkmark")
                                .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(brandGreenDark)
                    }
                case .ending:
                    Label("Saving", systemImage: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.secondary)
                case .retry:
                    Button(intent: EndShiftIntent(shiftId: shiftId)) {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.bordered)
                    .tint(phase.accent(in: colorScheme))
                case .completed:
                    Label("Saved", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(phase.accent(in: colorScheme))
                }
            } else {
                Label("Open app", systemImage: "arrow.up.forward.app")
                    .foregroundStyle(phase.accent(in: colorScheme))
                    .accessibilityHint("Open WagesTracker to end this shift")
            }
        }
        .font(.system(.caption, design: .rounded, weight: .bold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .buttonBorderShape(.capsule)
    }
}

@available(iOSApplicationExtension 16.1, *)
struct ShiftLockScreenView: View {
    let attributes: ShiftActivityAttributes
    let state: ShiftActivityAttributes.ContentState
    var isStale = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    private var accent: Color { state.phase.accent(in: colorScheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Image(systemName: state.phase.symbol)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(accent)
                    .frame(width: 30, height: 30)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isStale && state.phase == .active ? "Open app to refresh" : state.phase.title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(state.phase == .confirming ? "Your account stays signed in." : attributes.location)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .accessibilityLabel(state.phase == .confirming ? "Your account stays signed in." : "Work location: \(attributes.location)")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if state.phase != .confirming {
                    ShiftActivityAction(shiftId: attributes.shiftId, phase: state.phase)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }

            if state.phase == .active || state.phase == .completed || dynamicTypeSize <= .large {
              HStack(alignment: .bottom, spacing: 16) {
                VStack(alignment: .leading, spacing: 1) {
                    caption(state.phase == .completed ? "TOTAL TIME" : "TIME WORKED")
                    ShiftElapsedText(
                        startedAt: attributes.startedAt,
                        endedAt: state.endedAt,
                        finalDurationSeconds: state.finalDurationSeconds
                    )
                    .font(.system(size: dynamicTypeSize.isAccessibilitySize ? 34 : 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(.primary)
                    .accessibilityLabel(state.phase == .completed ? "Total shift time" : "Elapsed shift time")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 2) {
                    caption("STARTED")
                    Text(attributes.startedAt, style: .time)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                    Text(attributes.startedAt, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated))
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .accessibilityElement(children: .combine)
              }
            }

            if state.phase == .confirming {
                ShiftActivityAction(shiftId: attributes.shiftId, phase: state.phase)
            } else if state.phase == .retry || state.phase == .ending {
                Text(state.message ?? "Open WagesTracker to check this shift.")
                    .font(.caption2)
                    .foregroundStyle(state.phase == .retry ? accent : Color.secondary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            } else if state.phase == .active && dynamicTypeSize <= .large {
                ShiftHoursChart(startedAt: attributes.startedAt, accent: accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        // ActivityKit truncates beyond 160pt. Let the chart yield space to
        // accessible text and confirmation controls; cap text to this surface.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .animation(reduceMotion || isLuminanceReduced ? nil : .easeInOut(duration: 0.2), value: state.phase)
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 8, weight: .bold))
            .tracking(0.7)
            .foregroundStyle(.secondary)
    }
}

@available(iOSApplicationExtension 16.1, *)
struct ShiftActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShiftActivityAttributes.self) { context in
            ShiftLockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
                .activitySystemActionForegroundColor(.primary)
                .widgetURL(URL(string: "wagestracker://active-shift"))
                .preferredColorScheme(preferredColorScheme(context.state.appearance))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.phase == .active ? "On shift" : context.state.phase.title,
                          systemImage: context.state.phase.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(context.state.phase.accent(in: .dark))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ShiftElapsedText(
                        startedAt: context.attributes.startedAt,
                        endedAt: context.state.endedAt,
                        finalDurationSeconds: context.state.finalDurationSeconds
                    )
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .frame(width: 94, alignment: .trailing)
                    .accessibilityLabel("Elapsed shift time")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 10) {
                        if context.state.phase == .confirming {
                            Text("End this shift? Your account stays signed in.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            ShiftActivityAction(shiftId: context.attributes.shiftId, phase: context.state.phase)
                        } else {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(context.attributes.location)
                                        .font(.caption.weight(.semibold))
                                        .lineLimit(1)
                                    Text("Started \(context.attributes.startedAt.formatted(date: .omitted, time: .shortened))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                ShiftActivityAction(shiftId: context.attributes.shiftId, phase: context.state.phase)
                            }
                            if context.state.phase == .active {
                                ShiftHoursChart(startedAt: context.attributes.startedAt, accent: context.state.phase.accent(in: .dark))
                            } else if let message = context.state.message, context.state.phase == .retry || context.state.phase == .ending {
                                Text(message)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    }
                    .environment(\.colorScheme, .dark)
                }
            } compactLeading: {
                Image(systemName: context.state.phase.symbol)
                    .foregroundStyle(context.state.phase.accent(in: .dark))
                    .accessibilityLabel(context.state.phase.title)
            } compactTrailing: {
                ShiftElapsedText(
                    startedAt: context.attributes.startedAt,
                    endedAt: context.state.endedAt,
                    finalDurationSeconds: context.state.finalDurationSeconds
                )
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .frame(width: 52)
            } minimal: {
                Image(systemName: context.state.phase.symbol)
                    .foregroundStyle(context.state.phase.accent(in: .dark))
                    .accessibilityLabel(context.state.phase.title)
            }
            .keylineTint(context.state.phase.accent(in: .dark))
            .widgetURL(URL(string: "wagestracker://active-shift"))
        }
    }

    private func preferredColorScheme(_ appearance: String?) -> ColorScheme? {
        switch appearance {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}
