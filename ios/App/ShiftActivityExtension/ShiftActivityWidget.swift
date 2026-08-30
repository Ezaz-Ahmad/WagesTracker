import ActivityKit
import SwiftUI
import WidgetKit

private let brandGreen = Color(red: 0.08, green: 0.58, blue: 0.38)
private let brandGreenDark = Color(red: 0.04, green: 0.36, blue: 0.24)

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
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    ZStack {
                        Circle().fill(brandGreen.opacity(0.16))
                        Image(systemName: "clock.badge.checkmark.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(brandGreen)
                    }
                    .frame(width: 38, height: 38)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Circle().fill(brandGreen).frame(width: 7, height: 7)
                            Text(context.state.phase == .retry ? "Clock-out needs attention" : "Shift in progress")
                                .font(.headline)
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
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)
                        Text("worked today")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 12)
                    action(for: context)
                }

                if let message = context.state.message,
                   context.state.phase == .ending || context.state.phase == .retry {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(context.state.phase == .retry ? Color.orange : .secondary)
                        .lineLimit(2)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(brandGreen)
            .widgetURL(URL(string: "wagestracker://active-shift"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Live", systemImage: "circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(brandGreen)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ShiftElapsedText(
                        startedAt: context.attributes.startedAt,
                        endedAt: context.state.endedAt
                    )
                    .font(.headline.weight(.bold))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("Shift in progress")
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.attributes.location)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        action(for: context)
                    }
                }
            } compactLeading: {
                Image(systemName: "clock.fill")
                    .foregroundStyle(brandGreen)
            } compactTrailing: {
                ShiftElapsedText(
                    startedAt: context.attributes.startedAt,
                    endedAt: context.state.endedAt
                )
                .font(.caption2.weight(.bold))
                .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: context.state.phase == .retry ? "exclamationmark.circle.fill" : "clock.fill")
                    .foregroundStyle(context.state.phase == .retry ? Color.orange : brandGreen)
            }
            .keylineTint(brandGreen)
            .widgetURL(URL(string: "wagestracker://active-shift"))
        }
    }

    @ViewBuilder
    private func action(for context: ActivityViewContext<ShiftActivityAttributes>) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Button(intent: EndShiftIntent(shiftId: context.attributes.shiftId)) {
                Label(context.state.phase == .retry ? "Retry" : "Clock Out", systemImage: "stop.fill")
                    .font(.caption.weight(.bold))
            }
            .buttonStyle(.borderedProminent)
            .tint(context.state.phase == .retry ? .orange : brandGreenDark)
            .disabled(context.state.phase == .ending || context.state.phase == .completed)
        } else {
            Label("Open to clock out", systemImage: "arrow.up.forward.app")
                .font(.caption.weight(.semibold))
                .foregroundStyle(brandGreen)
        }
    }
}
