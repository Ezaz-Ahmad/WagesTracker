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

@available(iOSApplicationExtension 16.1, *)
struct ShiftActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShiftActivityAttributes.self) { context in
            let accent = phaseAccent(context.state.phase)

            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 10) {
                    ZStack {
                        Circle().fill(accent.opacity(0.15))
                        Circle().stroke(accent.opacity(0.2), lineWidth: 1)
                        Image(systemName: phaseSymbol(context.state.phase))
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    .frame(width: 40, height: 40)

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Circle().fill(accent).frame(width: 7, height: 7)
                            Text(phaseTitle(context.state.phase))
                                .font(.headline)
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                        }
                        Text(context.attributes.location)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                }

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        ShiftElapsedText(
                            startedAt: context.attributes.startedAt,
                            endedAt: context.state.endedAt
                        )
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)
                        Text("worked today")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 12)
                    if context.state.phase != .confirming {
                        action(for: context)
                    }
                }

                if context.state.phase == .confirming {
                    VStack(alignment: .leading, spacing: 9) {
                        Divider().opacity(0.45)
                        Text(context.state.message ?? "This ends the shift only. Your account stays signed in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        action(for: context)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                } else if let message = context.state.message,
                          context.state.phase == .ending || context.state.phase == .retry {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(context.state.phase == .retry ? attentionOrange : Color.secondary)
                        .lineLimit(2)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(accent)
            .widgetURL(URL(string: "wagestracker://active-shift"))
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
                        VStack(alignment: .leading, spacing: 7) {
                            Text("End this shift only?")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            action(for: context)
                        }
                    } else {
                        HStack {
                            Text(context.attributes.location)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
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
        case .confirming: return "Sign out of this shift?"
        case .ending: return "Signing out…"
        case .retry: return "Sign Out needs attention"
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

    @ViewBuilder
    private func action(for context: ActivityViewContext<ShiftActivityAttributes>) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            switch context.state.phase {
            case .active:
                Button(intent: RequestShiftSignOutIntent(shiftId: context.attributes.shiftId)) {
                    Label("Sign Out", systemImage: "stop.fill")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.borderedProminent)
                .tint(brandGreenDark)

            case .confirming:
                HStack(spacing: 8) {
                    Button(intent: CancelShiftSignOutIntent(shiftId: context.attributes.shiftId)) {
                        Label("Cancel", systemImage: "xmark")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)

                    Button(intent: EndShiftIntent(shiftId: context.attributes.shiftId)) {
                        Label("Yes, Sign Out", systemImage: "checkmark")
                            .font(.caption.weight(.bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(brandGreenDark)
                }

            case .ending:
                Label("Signing out…", systemImage: "arrow.triangle.2.circlepath")
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
            Label("Open to Sign Out", systemImage: "arrow.up.forward.app")
                .font(.caption.weight(.semibold))
                .foregroundStyle(brandGreen)
        }
    }
}
