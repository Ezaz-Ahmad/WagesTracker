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
    func requestSignOutConfirmation(shiftId: String) async {}
    func cancelSignOutConfirmation(shiftId: String) async {}
    func queueClockOut(shiftId: String) async -> ShiftClockOutQueueOutcome { .unavailable }
}
#endif

@available(iOS 17.0, *)
struct RequestShiftSignOutIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Sign out of work shift"
    static var description = IntentDescription("Shows a confirmation before ending the current work shift.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Shift identifier")
    var shiftId: String

    init() {
        self.shiftId = ""
    }

    init(shiftId: String) {
        self.shiftId = shiftId
    }

    func perform() async throws -> some IntentResult {
        await ShiftActivityCoordinator.shared.requestSignOutConfirmation(shiftId: shiftId)
        return .result()
    }
}

@available(iOS 17.0, *)
struct CancelShiftSignOutIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Keep shift running"
    static var description = IntentDescription("Cancels shift sign out and keeps the current shift running.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Shift identifier")
    var shiftId: String

    init() {
        self.shiftId = ""
    }

    init(shiftId: String) {
        self.shiftId = shiftId
    }

    func perform() async throws -> some IntentResult {
        await ShiftActivityCoordinator.shared.cancelSignOutConfirmation(shiftId: shiftId)
        return .result()
    }
}

@available(iOS 17.0, *)
struct EndShiftIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Confirm shift sign out"
    static var description = IntentDescription("Ends the current work shift without signing out of the account.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Shift identifier")
    var shiftId: String

    init() {
        self.shiftId = ""
    }

    init(shiftId: String) {
        self.shiftId = shiftId
    }

    func perform() async throws -> some IntentResult {

        let outcome = await ShiftActivityCoordinator.shared.queueClockOut(shiftId: shiftId)
        switch outcome {
        case .queued:
            return .result()
        case .alreadyQueued:
            return .result()
        case .unavailable:
            return .result()
        }
    }
}
