import ActivityKit
import SwiftUI
import WidgetKit

private let brandGreen = Color(red: 0.08, green: 0.58, blue: 0.38)
private let brandGreenDark = Color(red: 0.04, green: 0.36, blue: 0.24)
private let attentionOrange = Color(red: 0.92, green: 0.48, blue: 0.12)

@available(iOSApplicationExtension 16.1, *)
struct ShiftElapsedText: View {
    let startedAt: Date
    let endedAt: Date?

    var body: some View {
        Text(
            timerInterval: startedAt...startedAt.addingTimeInterval(48 * 60 * 60),
            pauseTime: endedAt,
            countsDown: false,
            showsHours: true
        )
        .monospacedDigit()
    }
}

/** A restrained eight-hour reference rail. It updates once a minute through
 * SwiftUI's timeline rather than waking the host app or running a custom
 * second-by-second timer; the system-rendered elapsed text remains the exact
 * source of truth above it. */
@available(iOSApplicationExtension 16.1, *)
struct ShiftProgressRail: View {
    let startedAt: Date
    let endedAt: Date?
    let accent: Color

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let current = endedAt ?? timeline.date
            let elapsed = max(0, current.timeIntervalSince(startedAt))
            let progress = min(1, elapsed / (8 * 60 * 60))

            VStack(spacing: 3) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.14))
                        Capsule()
                            .fill(accent.gradient)
                            .frame(width: max(4, proxy.size.width * progress))
                    }
                }
                .frame(height: 4)

                HStack {
                    Text("START")
                    Spacer()
                    Text("8H MARK")
                }
                .font(.system(size: 8, weight: .semibold))
                .tracking(0.45)
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityHidden(true)
    }
}

@available(iOSApplicationExtension 16.1, *)
struct ShiftActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShiftActivityAttributes.self) { context in
            let accent = phaseAccent(context.state.phase)

            // A glanceable hierarchy for the Lock Screen: state and location,
            // explicit start time, the live elapsed value, then one clear
            // action. The small rail adds progress context without competing
            // with the timer or spending battery on app-driven refreshes.
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 9) {
                    ZStack {
                        Circle().fill(accent.opacity(0.15))
                        Circle().stroke(accent.opacity(0.2), lineWidth: 1)
                        Image(systemName: phaseSymbol(context.state.phase))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    .frame(width: 34, height: 34)

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Circle().fill(accent).frame(width: 6, height: 6)
                            Text(phaseTitle(context.state.phase))
                                .font(.subheadline.weight(.bold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.76)
                        }
                        Text(context.attributes.location)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)

                    VStack(alignment: .trailing, spacing: 2) {
                        Text("STARTED")
                            .font(.system(size: 8, weight: .semibold))
                            .tracking(0.45)
                            .foregroundStyle(.secondary)
                        Text(context.attributes.startedAt, style: .time)
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(.primary)
                    }
                }

                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ELAPSED")
                            .font(.system(size: 8, weight: .semibold))
                            .tracking(0.45)
                            .foregroundStyle(.secondary)
                        ShiftElapsedText(
                            startedAt: context.attributes.startedAt,
                            endedAt: context.state.endedAt
                        )
                        .font(.system(size: 27, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)
                        .accessibilityLabel("Elapsed shift time")
                    }
                    Spacer(minLength: 12)
                    if context.state.phase != .confirming {
                        action(for: context)
                    }
                }

                if context.state.phase == .active {
                    ShiftProgressRail(
                        startedAt: context.attributes.startedAt,
                        endedAt: context.state.endedAt,
                        accent: accent
                    )
                }

                if context.state.phase == .confirming {
                    VStack(alignment: .leading, spacing: 7) {
                        Divider().opacity(0.35)
                        Text(context.state.message ?? "This ends the shift only. Your account stays signed in.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .minimumScaleFactor(0.82)
                        action(for: context)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else if let message = context.state.message,
                          context.state.phase == .ending || context.state.phase == .retry {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(context.state.phase == .retry ? attentionOrange : Color.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(accent)
            .widgetURL(URL(string: "wagestracker://active-shift"))
            .animation(.easeInOut(duration: 0.18), value: context.state.phase)
            .preferredColorScheme(preferredColorScheme(context.state.appearance))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Live", systemImage: "circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(phaseAccent(context.state.phase))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ShiftElapsedText(
                        startedAt: context.attributes.startedAt,
                        endedAt: context.state.endedAt
                    )
                    .font(.headline.weight(.bold))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(phaseTitle(context.state.phase))
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.phase == .confirming {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("End this shift only? Your account stays signed in.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            action(for: context)
                        }
                    } else {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(context.attributes.location)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Text("Started \(context.attributes.startedAt.formatted(date: .omitted, time: .shortened))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            action(for: context)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: phaseSymbol(context.state.phase))
                    .foregroundStyle(phaseAccent(context.state.phase))
            } compactTrailing: {
                ShiftElapsedText(
                    startedAt: context.attributes.startedAt,
                    endedAt: context.state.endedAt
                )
                .font(.caption2.weight(.bold))
                .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: phaseSymbol(context.state.phase))
                    .foregroundStyle(phaseAccent(context.state.phase))
            }
            .keylineTint(phaseAccent(context.state.phase))
            .widgetURL(URL(string: "wagestracker://active-shift"))
        }
    }

    private func phaseTitle(_ phase: ShiftActivityAttributes.ContentState.Phase) -> String {
        switch phase {
        case .active: return "Shift in progress"
        case .confirming: return "End this shift?"
        case .ending: return "Ending shift…"
        case .retry: return "End Shift needs attention"
        case .completed: return "Shift saved"
        }
    }

    private func phaseSymbol(_ phase: ShiftActivityAttributes.ContentState.Phase) -> String {
        switch phase {
        case .active: return "clock.badge.checkmark.fill"
        case .confirming: return "questionmark.circle.fill"
        case .ending: return "arrow.triangle.2.circlepath"
        case .retry: return "exclamationmark.circle.fill"
        case .completed: return "checkmark.circle.fill"
        }
    }

    private func phaseAccent(_ phase: ShiftActivityAttributes.ContentState.Phase) -> Color {
        phase == .retry || phase == .confirming ? attentionOrange : brandGreen
    }

    private func preferredColorScheme(_ appearance: String?) -> ColorScheme? {
        switch appearance {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    @ViewBuilder
    private func action(for context: ActivityViewContext<ShiftActivityAttributes>) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            switch context.state.phase {
            case .active:
                Button(intent: RequestShiftSignOutIntent(shiftId: context.attributes.shiftId)) {
                    Label("End Shift", systemImage: "stop.fill")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.borderedProminent)
                .tint(brandGreenDark)

            case .confirming:
                HStack(spacing: 8) {
                    Button(intent: CancelShiftSignOutIntent(shiftId: context.attributes.shiftId)) {
                        Label("Cancel", systemImage: "xmark")
                            .font(.caption2.weight(.semibold))
                    }
                    .buttonStyle(.bordered)

                    Button(intent: EndShiftIntent(shiftId: context.attributes.shiftId)) {
                        Label("End Shift", systemImage: "checkmark")
                            .font(.caption2.weight(.bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(brandGreenDark)
                }

            case .ending:
                Label("Ending shift…", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

            case .retry:
                Button(intent: EndShiftIntent(shiftId: context.attributes.shiftId)) {
                    Label("Retry", systemImage: "arrow.clockwise")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.borderedProminent)
                .tint(attentionOrange)

            case .completed:
                Label("Saved", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(brandGreen)
            }
        } else {
            Label("Open to End Shift", systemImage: "arrow.up.forward.app")
                .font(.caption.weight(.semibold))
                .foregroundStyle(brandGreen)
        }
    }
}
