import { EntryIcon, ReportIcon, TargetIcon } from "./icons";
import { useCountUp } from "../lib/useCountUp";
import { fmt2 } from "../lib/date";

/**
 * The marketing copy shared by every "not logged in yet" surface that shows
 * the dark hero treatment — today that's AuthScreen's desktop-only side
 * panel (`.landing-hero`, hidden below 960px — see styles/landing.css) and
 * WelcomeScreen's mobile-only full-screen intro. Extracted here so the two
 * surfaces show exactly the same three features and can't drift out of
 * sync with each other by editing one and forgetting the other.
 */
export const LANDING_FEATURES = [
  {
    icon: EntryIcon,
    title: "Clock in & out",
    body: "One tap to start or end a shift, with a live running timer.",
  },
  {
    icon: TargetIcon,
    title: "Set weekly goals",
    body: "Track hours and earnings against the goals you set.",
  },
  {
    icon: ReportIcon,
    title: "Export PDF reports",
    body: "Professional weekly reports, ready to download and share.",
  },
];

/** A live-looking (but entirely fake/illustrative — see the hardcoded
 * numbers below) stats card: "$647.50 this week, 82% toward your weekly
 * goal." Purely decorative marketing content, not a real figure pulled from
 * anyone's account — aria-hidden for that reason, same as the rest of the
 * hero's decorative elements. */
export function LandingPreviewCard() {
  const amount = useCountUp(647.5, 1400);
  const progress = useCountUp(82, 1400);

  return (
    <div className="landing-preview-card anim-rise" style={{ ["--i" as string]: 10 }} aria-hidden="true">
      <div className="landing-preview-kicker">This week</div>
      <div className="landing-preview-amount count-value">${fmt2(amount)}</div>
      <div className="landing-preview-trend">▲ 12% vs last week</div>
      <div className="progress-track landing-preview-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="landing-preview-caption count-value">{Math.round(progress)}% toward your weekly goal</div>
    </div>
  );
}

/**
 * The dark hero's copy block: kicker, headline, subtext, feature list, and
 * the live preview card — everything inside `.landing-hero-content`/
 * `.welcome-content` except the surrounding shell (background, decorative
 * shapes, layout), which each caller owns since AuthScreen's side panel and
 * WelcomeScreen's full-screen layout are shaped differently.
 */
export function LandingHeroContent() {
  return (
    <>
      <div className="landing-kicker anim-rise" style={{ ["--i" as string]: 0 }}>
        Wage Tracker
      </div>
      <h1 className="landing-headline anim-rise" style={{ ["--i" as string]: 2 }}>
        Track your hours.
        <br />
        Know your worth.
      </h1>
      <p className="landing-subtext anim-rise" style={{ ["--i" as string]: 4 }}>
        Clock in, log shifts, and watch your weekly earnings add up — with goal tracking and PDF reports built in.
      </p>
      <div className="landing-features">
        {LANDING_FEATURES.map((f, i) => (
          <div className="landing-feature anim-rise" style={{ ["--i" as string]: 6 + i }} key={f.title}>
            <span className="landing-feature-icon">
              <f.icon size={18} />
            </span>
            <div>
              <div className="landing-feature-title">{f.title}</div>
              <div className="landing-feature-body">{f.body}</div>
            </div>
          </div>
        ))}
      </div>
      <LandingPreviewCard />
    </>
  );
}
