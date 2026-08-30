import AppIntents

#if WIDGET_EXTENSION
// LiveActivityIntent executes in the containing app's process. The widget
// target still needs the intent's type to render Button(intent:), so it gets
// this compile-only stand-in while the app target links the real coordinator.
private enum ShiftClockOutQueueOutcome {
    case queued
    case alreadyQueued
    case unavailable
}

private actor ShiftActivityCoordinator {
    static let shared = ShiftActivityCoordinator()
    func queueClockOut(shiftId: String) async -> ShiftClockOutQueueOutcome { .unavailable }
}
#endif

@available(iOS 17.0, *)
struct EndShiftIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "End work shift"
    static var description = IntentDescription("Ends the current WagesTracker work shift.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Shift identifier")
    var shiftId: String

    init() {
        self.shiftId = ""
    }

    init(shiftId: String) {
        self.shiftId = shiftId
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // iOS presents a native confirm/cancel prompt and throws on cancel,
        // before any clock-out time is captured or network work is queued.
        try await requestConfirmation()

        let outcome = await ShiftActivityCoordinator.shared.queueClockOut(shiftId: shiftId)
        switch outcome {
        case .queued:
            return .result(dialog: "Clock-out requested. WagesTracker will keep it queued safely if you're offline.")
        case .alreadyQueued:
            return .result(dialog: "Your clock-out is already being processed.")
        case .unavailable:
            return .result(dialog: "Open WagesTracker to end this shift.")
        }
    }
}
