import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct ShiftActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable {
            case active
            case ending
            case retry
            case completed
        }

        var phase: Phase
        var endedAt: Date?
        var finalDurationSeconds: Int?
        var message: String?
    }

    let shiftId: String
    let startedAt: Date
    let location: String
}
